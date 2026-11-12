using System.Runtime.CompilerServices;
using System.Runtime.ExceptionServices;
using System.Text.Json.Nodes;

namespace CopilotKit.Intelligence;

/// <summary>
/// Lets an agent render generative UI surfaces with the <c>render_ui</c> tool. Ports
/// <c>generative-ui-middleware.ts</c>: each complete operation in the streamed arguments is validated
/// against the client's catalog and committed at once, as <c>ACTIVITY_SNAPSHOT</c> for a new surface and
/// <c>ACTIVITY_DELTA</c> for every further operation on it. Every call is answered before <c>RUN_FINISHED</c>.
/// </summary>
internal sealed class GenerativeUIAgent(IRuntimeAgent next, GenerativeUIManifest manifest) : IRuntimeAgent
{
    public string Description => next.Description;

    public async IAsyncEnumerable<JsonObject> RunAsync(JsonObject input, [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var prepared = Prepare(input);
        var run = new SurfaceRun(manifest, prepared);
        JsonObject? held = null; Exception? failure = null;
        await using var source = next.RunAsync(prepared, cancellationToken).GetAsyncEnumerator(cancellationToken);
        while (true)
        {
            bool available;
            try { available = await source.MoveNextAsync(); } catch (Exception error) { failure = error; break; }
            if (!available) break;
            var value = source.Current;
            if (held is not null) { yield return held; held = null; }
            if (JsonText.Str(value["type"]) == "RUN_FINISHED")
            {
                held = value; run.AnsweredAtFinish = new HashSet<string>(run.Answered, StringComparer.Ordinal);
                continue;
            }
            foreach (var item in run.Handle(value)) yield return item;
        }
        if (failure is not null)
        {
            if (held is not null) yield return held;
            ExceptionDispatchInfo.Capture(failure).Throw();
        }
        foreach (var item in run.Complete(held is not null)) yield return item;
        if (held is not null) yield return held;
    }

    /// <summary>Add the <c>render_ui</c> tool and the generative UI guide; never mutates <paramref name="input"/>.</summary>
    internal JsonObject Prepare(JsonObject input)
    {
        var value = (JsonObject)input.DeepClone();
        var tools = (value["tools"] as JsonArray ?? []).Where(tool => JsonText.Str(tool?["name"]) != GenerativeUI.RenderTool).Select(tool => tool?.DeepClone()).ToList();
        tools.Add(new JsonObject
        {
            ["name"] = GenerativeUI.RenderTool,
            ["description"] = "Render or update generative UI surfaces, or call app functions, with A2UI v1.0 operations. Follow the generative UI guide in context.",
            ["parameters"] = new JsonObject
            {
                ["type"] = "object",
                ["properties"] = new JsonObject
                {
                    ["target"] = new JsonObject
                    {
                        ["type"] = "string",
                        ["enum"] = new JsonArray(manifest.Targets.Select(target => target?["id"]?.DeepClone()).ToArray()),
                        ["description"] = "Where the surface is shown: \"chat\" or a named inline target."
                    },
                    ["operations"] = new JsonObject
                    {
                        ["type"] = "array",
                        ["description"] = "A2UI v1.0 operations, applied in order.",
                        ["items"] = new JsonObject { ["type"] = "object" }
                    }
                },
                ["required"] = new JsonArray("target", "operations")
            }
        });
        value["tools"] = new JsonArray(tools.ToArray());
        var context = (value["context"] as JsonArray ?? []).Where(entry => JsonText.Str(entry?["description"]) != GenerativeUI.ContextDescription).Select(entry => entry?.DeepClone()).ToList();
        context.Add(new JsonObject { ["description"] = GenerativeUI.ContextDescription, ["value"] = GenerativeUI.BuildPrompt(manifest) });
        value["context"] = new JsonArray(context.ToArray());
        return value;
    }
}

/// <summary>
/// Reads <c>target</c> and every complete <c>operations[]</c> element from streamed <c>render_ui</c>
/// arguments (<c>render-ui-args.ts</c>). Each push scans only the new text. An element that is balanced
/// but not a JSON object is reported as null.
/// </summary>
internal sealed class RenderUIArgsStream
{
    private readonly List<char> stack = [];
    private int emitted;
    private bool inString;
    private bool escaped;
    private int stringStart = -1;
    private string? pendingKey;
    private string? currentKey;
    private bool expectingValue;
    private bool inOperations;
    private int elementStart = -1;

    internal string Text { get; private set; } = "";
    internal string? Target { get; private set; }
    internal List<JsonObject?> Operations { get; } = [];
    /// <summary>True when the text so far ends inside an <c>operations[]</c> element.</summary>
    internal bool HasIncompleteOperation => elementStart >= 0;

    /// <summary>Add a delta; returns the target so far and the operations not reported before.</summary>
    internal (string? Target, List<JsonObject?> Operations) Push(string delta)
    {
        var start = Text.Length;
        Text += delta;
        var text = Text;
        for (var index = start; index < text.Length; index++)
        {
            var character = text[index];
            if (inString)
            {
                if (escaped) escaped = false;
                else if (character == '\\') escaped = true;
                else if (character == '"')
                {
                    inString = false;
                    if (stack.Count == 1)
                    {
                        var literal = text[stringStart..(index + 1)];
                        if (expectingValue)
                        {
                            if (currentKey == "target" && JsonText.TryParse(literal, out var target)) Target = JsonText.Str(target);
                            expectingValue = false;
                        }
                        else pendingKey = literal;
                    }
                }
                continue;
            }
            switch (character)
            {
                case '"':
                    inString = true; stringStart = index;
                    break;
                case ':':
                    if (stack.Count == 1 && pendingKey is not null)
                    {
                        currentKey = JsonText.TryParse(pendingKey, out var key) ? JsonText.Str(key) : null;
                        pendingKey = null; expectingValue = true;
                    }
                    break;
                case ',':
                    if (stack.Count == 1) { expectingValue = false; currentKey = null; }
                    break;
                case '{':
                    if (inOperations && stack.Count == 2) elementStart = index;
                    stack.Add('{');
                    break;
                case '[':
                    if (stack.Count == 1 && expectingValue && currentKey == "operations") inOperations = true;
                    stack.Add('[');
                    break;
                case '}' or ']':
                    if (stack.Count > 0) stack.RemoveAt(stack.Count - 1);
                    if (character == '}' && inOperations && stack.Count == 2 && elementStart >= 0)
                    {
                        Operations.Add(JsonText.TryParse(text[elementStart..(index + 1)], out var element) ? element as JsonObject : null);
                        elementStart = -1;
                    }
                    if (character == ']' && inOperations && stack.Count == 1) { inOperations = false; expectingValue = false; }
                    break;
            }
        }
        var fresh = Operations.Skip(emitted).ToList();
        emitted = Operations.Count;
        return (Target, fresh);
    }
}

/// <summary>The surfaces, created ids and render_ui calls of one run.</summary>
internal sealed class SurfaceRun
{
    private sealed class RenderCall
    {
        internal RenderUIArgsStream Stream { get; } = new();
        internal string? Target { get; set; }
        internal List<JsonObject?> Buffered { get; set; } = [];
        internal int NextIndex { get; set; }
        internal int Applied { get; set; }
        internal JsonArray Rejected { get; } = [];
        // The surfaces this call touched, in order.
        internal List<string> Touched { get; } = [];
        internal bool Finished { get; set; }
        internal bool Touch(string surfaceId) { if (Touched.Contains(surfaceId)) return false; Touched.Add(surfaceId); return true; }
    }

    private readonly GenerativeUIManifest manifest;
    private readonly Dictionary<string, string> surfaces = new(StringComparer.Ordinal);
    private readonly HashSet<string> created = new(StringComparer.Ordinal);
    private readonly Dictionary<string, IReadOnlyList<string>> targetComponents = new(StringComparer.Ordinal);
    private readonly List<KeyValuePair<string, RenderCall>> calls = [];
    private List<JsonObject> output = [];

    internal HashSet<string> Answered { get; } = new(StringComparer.Ordinal);
    internal HashSet<string> AnsweredAtFinish { get; set; } = new(StringComparer.Ordinal);

    internal SurfaceRun(GenerativeUIManifest manifest, JsonObject input)
    {
        this.manifest = manifest;
        foreach (var (surfaceId, node) in manifest.Surfaces)
        {
            if (node is not JsonObject summary) continue;
            // Only live surfaces take updates; a deleted or never-created one has a status.
            if (!JsonText.Truthy(summary["status"])) surfaces[surfaceId] = JsonText.Str(summary["target"])!;
            // A surface id is unique for the life of the page. A failed create can be retried.
            if (JsonText.Str(summary["status"]) != "failed") created.Add(surfaceId);
        }
        foreach (var target in manifest.Targets.OfType<JsonObject>())
            if (target["components"] is JsonArray names) targetComponents[JsonText.Str(target["id"])!] = names.Select(name => JsonText.Str(name)!).ToList();
        foreach (var message in input["messages"] as JsonArray ?? [])
            if (JsonText.Str(message?["role"]) == "tool" && JsonText.Str(message?["toolCallId"]) is { } id) Answered.Add(id);
    }

    private RenderCall? Call(string id) => calls.FirstOrDefault(pair => pair.Key == id).Value;

    private void Patch(string surfaceId, IEnumerable<JsonObject> operations) => output.Add(new JsonObject
    {
        ["type"] = "ACTIVITY_DELTA",
        ["messageId"] = GenerativeUI.SurfaceMessageId(surfaceId),
        ["activityType"] = GenerativeUI.ActivityType,
        ["patch"] = new JsonArray(operations.ToArray<JsonNode?>())
    });

    /// <summary>Mark a surface streaming and clear its rejections the first time a call touches it.</summary>
    private static IEnumerable<JsonObject> BeginUpdate(RenderCall state, string surfaceId) => state.Touch(surfaceId)
        ? [new JsonObject { ["op"] = "replace", ["path"] = "/status", ["value"] = "streaming" }, new JsonObject { ["op"] = "replace", ["path"] = "/rejected", ["value"] = new JsonArray() }]
        : [];

    private void Reject(RenderCall state, int index, string reason, string? surfaceId)
    {
        var entry = new JsonObject { ["index"] = index, ["reason"] = reason };
        state.Rejected.Add(entry);
        if (surfaceId is { Length: > 0 } && surfaces.ContainsKey(surfaceId))
            Patch(surfaceId, [.. BeginUpdate(state, surfaceId), new JsonObject { ["op"] = "add", ["path"] = "/rejected/-", ["value"] = entry.DeepClone() }]);
    }

    /// <summary>A createSurface keeps a listed catalogId and gets the run's catalog otherwise.</summary>
    private JsonObject WithCatalogId(JsonObject op)
    {
        if (op["createSurface"] is not JsonObject) return op;
        var result = (JsonObject)op.DeepClone();
        var create = (JsonObject)result["createSurface"]!;
        var catalogIds = manifest.CatalogIds.Count > 0 ? manifest.CatalogIds : [manifest.CatalogId];
        if (JsonText.Str(create["catalogId"]) is not { } catalogId || !catalogIds.Contains(catalogId)) create["catalogId"] = manifest.CatalogId;
        return result;
    }

    private void Process(RenderCall state, JsonObject? op)
    {
        var index = state.NextIndex++;
        if (op is null) { Reject(state, index, "operation is not valid JSON", null); return; }
        string? surfaceId = null;
        try
        {
            surfaceId = GenerativeUI.OperationSurfaceId(op);
            Apply(state, index, WithCatalogId(op), surfaceId);
        }
        catch (Exception error)
        {
            // One bad operation must not take down the run; the tool result reports it.
            Reject(state, index, "operation could not be processed: " + error.Message, surfaceId);
        }
    }

    private void Apply(RenderCall state, int index, JsonObject op, string? surfaceId)
    {
        var kind = GenerativeUI.OperationKind(op);
        var target = kind == "createSurface" ? state.Target : surfaces.GetValueOrDefault(surfaceId ?? "");
        var names = target is not null ? targetComponents.GetValueOrDefault(target) : null;
        var reason = GenerativeUI.ValidateOperation(op, manifest, surfaces.Keys, created, manifest.Functions,
            target is not null && names is not null ? new AllowedComponents(target, names) : null);
        if (reason is not null) { Reject(state, index, reason, surfaceId); return; }
        if (kind == "createSurface") { Create(state, index, surfaceId!, op); return; }
        Patch(surfaceId!, [.. BeginUpdate(state, surfaceId!), new JsonObject { ["op"] = "add", ["path"] = "/operations/-", ["value"] = op.DeepClone() }]);
        if (kind == "deleteSurface") surfaces.Remove(surfaceId!);
        state.Applied++;
    }

    private void Create(RenderCall state, int index, string surfaceId, JsonObject op)
    {
        var target = state.Target;
        if (target is null) { Reject(state, index, "render_ui was called without a target", null); return; }
        if (!manifest.Targets.Any(entry => JsonText.Str(entry?["id"]) == target)) { Reject(state, index, $"target \"{target}\" is not mounted", null); return; }
        surfaces[surfaceId] = target;
        created.Add(surfaceId);
        output.Add(new JsonObject
        {
            ["type"] = "ACTIVITY_SNAPSHOT",
            ["messageId"] = GenerativeUI.SurfaceMessageId(surfaceId),
            ["activityType"] = GenerativeUI.ActivityType,
            ["content"] = new JsonObject
            {
                ["surfaceId"] = surfaceId,
                ["target"] = target,
                ["catalogId"] = JsonText.Str(op["createSurface"]!["catalogId"]) is { Length: > 0 } catalogId ? catalogId : manifest.CatalogId,
                ["operations"] = new JsonArray(op.DeepClone()),
                ["status"] = "streaming",
                ["rejected"] = new JsonArray()
            },
            ["replace"] = true
        });
        state.Touch(surfaceId);
        state.Applied++;
    }

    /// <summary>Hold operations until the target is known.</summary>
    private void Accept(RenderCall state, JsonObject? op)
    {
        if (state.Target is null) state.Buffered.Add(op);
        else Process(state, op);
    }

    /// <summary>Recover operations that the model sent as a JSON-encoded string.</summary>
    private void Recover(RenderCall state)
    {
        if (!JsonText.TryParse(state.Stream.Text, out var parsed) || parsed is not JsonObject args) return;
        if (state.Target is null && JsonText.Str(args["target"]) is { } target) state.Target = target;
        var operations = args["operations"];
        if (JsonText.Str(operations) is { } encoded && !JsonText.TryParse(encoded, out operations)) return;
        if (operations is not JsonArray list) return;
        foreach (var op in list) Accept(state, op as JsonObject);
    }

    private void Finish(RenderCall state)
    {
        if (state.Finished) return;
        state.Finished = true;
        if (state.NextIndex == 0 && state.Buffered.Count == 0) Recover(state);
        if (state.Target is null)
        {
            // Function calls need no target; every other operation is rejected.
            var buffered = state.Buffered; state.Buffered = [];
            foreach (var op in buffered)
            {
                if (GenerativeUI.OperationKind(op) == "callRendererFunction") { Process(state, op); continue; }
                state.Rejected.Add(new JsonObject { ["index"] = state.NextIndex, ["reason"] = "render_ui was called without a target" });
                state.NextIndex++;
            }
        }
        if (state.Stream.HasIncompleteOperation)
        {
            // The arguments ended inside an element, for example at the output limit.
            state.Rejected.Add(new JsonObject { ["index"] = state.NextIndex, ["reason"] = "operation was truncated" });
            state.NextIndex++;
        }
        foreach (var surfaceId in state.Touched) Patch(surfaceId, [new JsonObject { ["op"] = "replace", ["path"] = "/status", ["value"] = "ready" }]);
    }

    /// <summary>Pass one event through and return it with the surface events it caused.</summary>
    internal List<JsonObject> Handle(JsonObject value)
    {
        output = [value];
        var kind = JsonText.Str(value["type"]);
        if (JsonText.Str(value["toolCallId"]) is not { } callId) return output;
        if (kind == "TOOL_CALL_RESULT") Answered.Add(callId);
        else if (kind == "TOOL_CALL_START" && JsonText.Str(value["toolCallName"]) == GenerativeUI.RenderTool)
        {
            var index = calls.FindIndex(pair => pair.Key == callId);
            if (index >= 0) calls[index] = new(callId, new RenderCall()); else calls.Add(new(callId, new RenderCall()));
        }
        else if (kind == "TOOL_CALL_ARGS" && Call(callId) is { } state)
        {
            if (!state.Finished && JsonText.Str(value["delta"]) is { } delta)
            {
                var (target, operations) = state.Stream.Push(delta);
                if (target is not null && state.Target is null)
                {
                    state.Target = target;
                    var buffered = state.Buffered; state.Buffered = [];
                    foreach (var op in buffered) Process(state, op);
                }
                foreach (var op in operations) Accept(state, op);
            }
        }
        else if (kind == "TOOL_CALL_END" && Call(callId) is { } ended) Finish(ended);
        return output;
    }

    /// <summary>Finish every call and, before a held RUN_FINISHED, answer the unanswered ones.</summary>
    internal List<JsonObject> Complete(bool finished)
    {
        output = [];
        foreach (var (_, state) in calls) Finish(state);
        if (!finished) return output;
        foreach (var (callId, state) in calls)
        {
            if (AnsweredAtFinish.Contains(callId)) continue;
            var nothing = state.Applied == 0 && state.Rejected.Count == 0;
            var result = nothing
                ? new JsonObject { ["status"] = "error", ["applied"] = 0, ["calls"] = 0, ["rejected"] = new JsonArray(), ["reason"] = "operations must be a JSON array of A2UI operation objects; nothing was rendered" }
                : new JsonObject { ["status"] = "rendered", ["applied"] = state.Applied, ["calls"] = 0, ["rejected"] = state.Rejected.DeepClone() };
            output.Add(new JsonObject { ["type"] = "TOOL_CALL_RESULT", ["messageId"] = Guid.NewGuid().ToString(), ["toolCallId"] = callId, ["content"] = JsonText.Compact(result) });
        }
        return output;
    }
}

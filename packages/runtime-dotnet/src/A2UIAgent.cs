using System.Runtime.CompilerServices;
using System.Runtime.ExceptionServices;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace CopilotKit.Intelligence;

/// <summary>Runtime A2UI 0.0.10 behavior. Generation retries remain the agent adapter's responsibility.</summary>
public sealed class A2UIOptions
{
    public bool Enabled { get; init; } = true;
    public bool? InjectTool { get; init; }
    public string ToolName { get; init; } = "render_a2ui";
    public IReadOnlySet<string>? ToolNames { get; init; }
    public IReadOnlySet<string>? Agents { get; init; }
    public JsonNode? Schema { get; init; }
    public string? DefaultCatalogId { get; init; }
    public bool ShowProgressTokens { get; init; } = true;
    public int MaxAttempts { get; init; } = 3;
    public string? DebugExposure { get; init; }

    /// <summary>Reads the published runtime configuration shape; invalid options fail during configuration.</summary>
    public static A2UIOptions FromJson(JsonObject value) => new()
    {
        Enabled = value["enabled"]?.GetValue<bool>() ?? true,
        InjectTool = value["injectA2UITool"] is JsonValue injection && injection.TryGetValue<bool>(out var enabled) ? enabled : value["injectA2UITool"] is null ? null : true,
        ToolName = A2UIValidation.Text(value["injectA2UITool"]) ?? "render_a2ui",
        ToolNames = value["a2uiToolNames"] is JsonArray names ? names.Select(node => node!.GetValue<string>()).ToHashSet(StringComparer.Ordinal) : null,
        Agents = value["agents"] is JsonArray agents ? agents.Select(node => node!.GetValue<string>()).ToHashSet(StringComparer.Ordinal) : null,
        Schema = value["schema"]?.DeepClone(), DefaultCatalogId = A2UIValidation.Text(value["defaultCatalogId"]),
        ShowProgressTokens = value["recovery"]?["showProgressTokens"]?.GetValue<bool>() ?? true,
        MaxAttempts = value["recovery"]?["maxAttempts"]?.GetValue<int>() ?? 3,
        DebugExposure = A2UIValidation.Text(value["recovery"]?["debugExposure"])
    };
}

/// <summary>Transforms tool calls to validated A2UI activities before Intelligence persists the stream.</summary>
public sealed class A2UIAgent(IRuntimeAgent next, A2UIOptions options, bool providerCatalogAvailable = false) : IRuntimeAgent
{
    public const string SchemaContextDescription = "A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations.";
    public const string BasicCatalogId = "https://a2ui.org/specification/v0_9/basic_catalog.json";
    public string Description => next.Description;
    private bool Inject => options.InjectTool ?? providerCatalogAvailable;
    private sealed class Streaming(string? outer)
    {
        internal string? Outer { get; } = outer;
        internal string Args { get; set; } = "";
        internal JsonArray? Components { get; set; }
        internal string? SurfaceId { get; set; }
        internal string? CatalogId { get; set; }
        internal bool Rejected { get; set; }
        internal bool DataComplete { get; set; }
        internal string DataKey { get; set; } = "items";
        internal int DataCount { get; set; }
    }

    public async IAsyncEnumerable<JsonObject> RunAsync(JsonObject input, [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var frontendCatalogId = FrontendCatalog(input);
        var enhanced = Enhance(input);
        var recognized = new HashSet<string>(options.ToolNames ?? new HashSet<string> { "render_a2ui" }, StringComparer.Ordinal);
        if (Inject) recognized.Add(options.ToolName);
        var streaming = new Dictionary<string, Streaming>(StringComparer.Ordinal);
        var calls = new AgentToolCalls(enhanced);
        var streamedSurfaces = new HashSet<string>(StringComparer.Ordinal);
        var retrying = new HashSet<string>(StringComparer.Ordinal);
        var attempts = new Dictionary<string, int>(StringComparer.Ordinal);
        var progress = new Dictionary<string, int>(StringComparer.Ordinal);
        string? outer = null;
        JsonObject? held = null; Exception? failure = null;
        await using var source = next.RunAsync(enhanced, cancellationToken).GetAsyncEnumerator(cancellationToken);
        while (true)
        {
            bool available;
            try { available = await source.MoveNextAsync(); } catch (Exception error) { failure = error; break; }
            if (!available) break;
            var value = source.Current; calls.Observe(value);
            var type = A2UIValidation.Text(value["type"]); var id = A2UIValidation.Text(value["toolCallId"]) ?? "";
            if (type == "TOOL_CALL_START")
            {
                var name = A2UIValidation.Text(value["toolCallName"]) ?? "";
                if (recognized.Contains(name))
                {
                    streaming[id] = new Streaming(outer); var key = outer ?? id;
                    attempts[key] = attempts.GetValueOrDefault(key) + 1; progress[key] = 0;
                    if (!retrying.Contains(key)) yield return Lifecycle(key, new JsonObject { ["status"] = "building" });
                }
                else if (name != "log_a2ui_event") outer = id;
            }
            if (type == "TOOL_CALL_ARGS" && streaming.TryGetValue(id, out var state))
            {
                state.Args += A2UIValidation.Text(value["delta"]) ?? "";
                if (state.Args.Length > 4 * 1024 * 1024) throw new RuntimeRequestException(502, "A2UI tool arguments exceed size limit");
                var key = state.Outer ?? id;
                if (options.ShowProgressTokens && state.Components is null && !state.Rejected && !retrying.Contains(key))
                {
                    var tokens = (int)Math.Floor(state.Args.Length / 4.0 + 0.5);
                    if (tokens - progress.GetValueOrDefault(key) >= 20) { progress[key] = tokens; yield return Lifecycle(key, new JsonObject { ["status"] = "building", ["progressTokens"] = tokens }); }
                }
                var surface = A2UIValidation.Text(PartialJson.Field(state.Args, "surfaceId"));
                if (!string.IsNullOrEmpty(surface))
                {
                    var catalog = !string.IsNullOrEmpty(options.DefaultCatalogId) ? options.DefaultCatalogId : frontendCatalogId ?? A2UIValidation.Text(PartialJson.Field(state.Args, "catalogId"));
                    if (string.IsNullOrEmpty(catalog) || catalog == "basic") catalog = BasicCatalogId;
                    var componentsAdvanced = false;
                    if (state.Components is null && !state.Rejected)
                    {
                        var parsed = PartialJson.Array(state.Args, "components");
                        if (parsed is { Closed: true } && parsed.Value.Items.Count > 0 && parsed.Value.Items.All(node => node is JsonObject comp && A2UIValidation.Text(comp["component"]) is not null))
                        {
                            var validationCatalog = options.Schema is JsonObject schema && schema["components"] is JsonObject schemas && schemas.Count > 0 ? schema : null;
                            var errors = A2UIValidation.ValidateComponents(parsed.Value.Items, validationCatalog);
                            if (errors.Count == 0)
                            {
                                state.Components = parsed.Value.Items; componentsAdvanced = true;
                                state.SurfaceId = surface; state.CatalogId = catalog;
                                state.DataKey = state.Components.Select(node => node?["children"] as JsonObject).Select(children => A2UIValidation.Text(children?["path"])).FirstOrDefault(path => !string.IsNullOrEmpty(path))?.TrimStart('/') ?? "items";
                            }
                            else
                            {
                                state.Rejected = true; retrying.Add(key); progress[key] = 0;
                                yield return Lifecycle(key, new JsonObject { ["status"] = "retrying", ["attempt"] = Math.Min(attempts.GetValueOrDefault(key, 1) + 1, options.MaxAttempts), ["maxAttempts"] = options.MaxAttempts, ["errors"] = errors });
                            }
                        }
                    }
                    if (state.Components is not null)
                    {
                        surface = state.SurfaceId!; catalog = state.CatalogId!;
                        var partialData = state.DataComplete ? null : PartialJson.DataArray(state.Args, state.DataKey);
                        var dataAdvanced = partialData.HasValue && partialData.Value.Items.Count > state.DataCount;
                        if (componentsAdvanced || dataAdvanced)
                        {
                            JsonObject? data = null;
                            if (dataAdvanced) { state.DataCount = partialData!.Value.Items.Count; data = new JsonObject { [state.DataKey] = partialData.Value.Items }; }
                            streamedSurfaces.Add(surface); retrying.Remove(key);
                            yield return Surface(key, surface, catalog!, state.Components, data);
                        }
                        if (!state.DataComplete && PartialJson.Field(state.Args, "data") is JsonObject complete)
                        {
                            state.DataComplete = true;
                            yield return Surface(key, surface, catalog!, state.Components, complete);
                        }
                    }
                }
            }
            if (held is not null) { yield return held; held = null; }
            if (type == "RUN_FINISHED") { held = value; continue; }
            yield return value;
            if (type == "TOOL_CALL_RESULT")
            {
                var handled = streaming.Values.Any(entry => entry.Components is not null && (entry.Outer == id || streaming.GetValueOrDefault(id) == entry));
                if (!handled)
                {
                    var parsed = ParseContainer(A2UIValidation.Text(value["content"]));
                    if (parsed?["a2ui_operations"] is JsonArray operations)
                    {
                        var filtered = operations.Where(op => SurfaceId(op) is not { } target || !streamedSurfaces.Contains(target)).ToList();
                        var groups = filtered.GroupBy(op => SurfaceId(op) ?? "default").ToList();
                        foreach (var group in groups)
                        {
                            var key = outer ?? id;
                            if (groups.Count > 1) key = group.Key + "-" + key;
                            yield return Activity(key, new JsonObject { ["a2ui_operations"] = new JsonArray(group.Select(op => op?.DeepClone()).ToArray()) });
                        }
                    }
                    else if (A2UIValidation.Text(parsed?["code"]) == "a2ui_recovery_exhausted")
                    {
                        var key = outer ?? id; var attemptHistory = parsed?["attempts"]?.DeepClone() ?? new JsonArray();
                        yield return Lifecycle(key, new JsonObject { ["status"] = "failed", ["error"] = A2UIValidation.Text(parsed?["error"]) ?? "A2UI generation failed", ["attempts"] = attemptHistory, ["maxAttempts"] = attemptHistory is JsonArray list && list.Count > 0 ? list.Count : options.MaxAttempts });
                        retrying.Remove(key);
                    }
                }
                if (outer == id) outer = null;
            }
        }
        if (held is not null)
        {
            if (failure is null) foreach (var call in calls.Pending.Where(call => recognized.Contains(call.Name))) yield return AgentToolCalls.Result(call.Id, "{\"status\":\"rendered\"}");
            yield return held;
        }
        if (failure is not null) ExceptionDispatchInfo.Capture(failure).Throw();
    }

    private JsonObject Enhance(JsonObject input)
    {
        var value = (JsonObject)input.DeepClone();
        if (value["forwardedProps"]?["a2uiAction"]?["userAction"] is JsonObject action)
        {
            var call = Guid.NewGuid().ToString();
            var message = $"User performed action \"{A2UIValidation.Text(action["name"]) ?? "unknown_action"}\" on surface \"{A2UIValidation.Text(action["surfaceId"]) ?? "unknown_surface"}\"";
            if (A2UIValidation.Text(action["sourceComponentId"]) is { Length: > 0 } component) message += $" (component: {component})";
            message += ". Context: " + (action["context"]?.ToJsonString() ?? "{}");
            var messages = value["messages"]!.AsArray();
            messages.Add(new JsonObject { ["id"] = Guid.NewGuid().ToString(), ["role"] = "assistant", ["content"] = "", ["toolCalls"] = new JsonArray(new JsonObject { ["id"] = call, ["type"] = "function", ["function"] = new JsonObject { ["name"] = "log_a2ui_event", ["arguments"] = action.ToJsonString() } }) });
            messages.Add(new JsonObject { ["id"] = Guid.NewGuid().ToString(), ["role"] = "tool", ["toolCallId"] = call, ["content"] = message });
        }
        if (options.Schema is JsonArray { Count: > 0 } || options.Schema is JsonObject schema && schema["components"] is JsonObject { Count: > 0 }) AddContext(value, SchemaContextDescription, options.Schema.ToJsonString());
        if (Inject)
        {
            value["tools"] = new JsonArray(value["tools"]!.AsArray().Where(tool => A2UIValidation.Text(tool?["name"]) != options.ToolName).Select(tool => tool?.DeepClone()).Append(RenderTool()).ToArray());
            value["forwardedProps"] ??= new JsonObject();
            value["forwardedProps"]!["injectA2UITool"] = options.ToolName == "render_a2ui" ? JsonValue.Create(true) : JsonValue.Create(options.ToolName);
            AddContext(value, $"A2UI render tool usage guide — how to call {options.ToolName} with valid arguments.", Guidelines(options.ToolName));
        }
        return value;
    }
    private JsonObject RenderTool() => new()
    {
        ["name"] = options.ToolName,
        ["description"] = "Render a dynamic A2UI v0.9 surface with structured parameters. Follow the A2UI render tool usage guide provided in context.",
        ["parameters"] = new JsonObject { ["type"] = "object", ["required"] = new JsonArray("surfaceId", "components"), ["properties"] = new JsonObject
        {
            ["surfaceId"] = new JsonObject { ["type"] = "string", ["description"] = "Unique surface identifier." },
            ["components"] = new JsonObject { ["type"] = "array", ["description"] = "A2UI v0.9 component array (flat format). The root component must have id \"root\".", ["items"] = new JsonObject { ["type"] = "object" } },
            ["data"] = new JsonObject { ["type"] = "object", ["description"] = "Initial data model for the surface. Written to the root path. Use for pre-filling form values (e.g. {\"form\": {\"name\": \"Alice\"}}) or providing data for components bound to data model paths." }
        } }
    };
    // Tool contract and guidance adapted from @ag-ui/a2ui-middleware 0.0.10 (MIT).
    private static string Guidelines(string toolName) => $$"""
        ## How to call {{toolName}}

        You MUST provide ALL required arguments when calling {{toolName}}:

        - **surfaceId** (string, required): Unique ID for the surface (e.g. "sales-dashboard").
        - **components** (array, REQUIRED): A2UI v0.9 flat component array. NEVER omit this.
        - **data** (object, optional): Initial data model for path-bound component values.

        Note: the catalog id is set by the host, not by you. Do not include a catalogId argument.

        ### Component format (v0.9 flat)

        Components are a flat array — children are referenced by ID, not nested:
        - Every component has `id` (unique) and `component` (type name from the available catalog).
        - The root component MUST have `id: "root"`.
        - Properties go directly on the component object.
        - Use `children: ["id1", "id2"]` for multiple children, `child: "id"` for a single child.

        ### Minimal example

        ```json
        {
          "surfaceId": "my-dashboard",
          "components": [
            { "id": "root", "component": "Column", "children": ["title", "row1"] },
            { "id": "title", "component": "Title", "text": "Overview" },
            { "id": "row1", "component": "Row", "children": ["m1", "m2"], "gap": 16 },
            { "id": "m1", "component": "Metric", "label": "Users", "value": "1,200" },
            { "id": "m2", "component": "Metric", "label": "Revenue", "value": "$50K" }
          ]
        }
        ```

        ### Key rules

        1. NEVER call {{toolName}} without the `components` array — the UI will be empty.
        2. Root must be a layout component (Column, Row, Card) — not Text or Button.
        3. Component IDs must be unique. A component must NOT reference itself as child.
        4. Only use component names from the Available Components schema in context.
        5. For data binding use `{ "path": "/key" }` (absolute) or `{ "path": "key" }` (relative inside templates).
        6. For repeating content: `children: { componentId: "card-id", path: "/items" }` repeats per array item.
        7. Button actions: `"action": { "event": { "name": "action_name", "context": { ... } } }` — event must be an object.
        8. No placeholder images — only use real URLs or Icon components.
        """;
    private static void AddContext(JsonObject input, string description, string text) => input["context"] = new JsonArray((input["context"] as JsonArray ?? []).Where(item => A2UIValidation.Text(item?["description"]) != description).Select(item => item?.DeepClone()).Append(new JsonObject { ["description"] = description, ["value"] = text }).ToArray());
    private static string? FrontendCatalog(JsonObject input)
    {
        var entry = (input["context"] as JsonArray ?? []).FirstOrDefault(item => A2UIValidation.Text(item?["description"]) == SchemaContextDescription);
        return A2UIValidation.Text(ParseContainer(A2UIValidation.Text(entry?["value"]))?["catalogId"]);
    }
    private static JsonObject? ParseContainer(string? text)
    {
        if (text is null) return null;
        try { var node = JsonNode.Parse(text); if (A2UIValidation.Text(node) is { } encoded) node = JsonNode.Parse(encoded); return node as JsonObject; } catch (JsonException) { return null; }
    }
    private static string? SurfaceId(JsonNode? op)
    {
        if (op is not JsonObject obj) return null;
        foreach (var key in new[] { "createSurface", "updateComponents", "updateDataModel", "deleteSurface" }) if (A2UIValidation.Text(obj[key]?["surfaceId"]) is { } id) return id;
        return null;
    }
    private JsonObject Lifecycle(string key, JsonObject content) { if (options.DebugExposure is not null) content["debugExposure"] = options.DebugExposure; return Activity(key, content); }
    private static JsonObject Activity(string key, JsonObject content) => new() { ["type"] = "ACTIVITY_SNAPSHOT", ["messageId"] = "a2ui-surface-" + key, ["activityType"] = "a2ui-surface", ["replace"] = true, ["content"] = content };
    private static JsonObject Surface(string key, string surface, string catalog, JsonArray components, JsonObject? data)
    {
        var operations = new JsonArray(new JsonObject { ["version"] = "v0.9", ["createSurface"] = new JsonObject { ["surfaceId"] = surface, ["catalogId"] = catalog } }, new JsonObject { ["version"] = "v0.9", ["updateComponents"] = new JsonObject { ["surfaceId"] = surface, ["components"] = components.DeepClone() } });
        if (data is not null) operations.Add(new JsonObject { ["version"] = "v0.9", ["updateDataModel"] = new JsonObject { ["surfaceId"] = surface, ["path"] = "/", ["value"] = data.DeepClone() } });
        return Activity(key, new JsonObject { ["a2ui_operations"] = operations });
    }
}

internal sealed class AgentToolCalls
{
    internal sealed record Call(string Id, string Name) { internal string Arguments { get; set; } = ""; }
    private readonly Dictionary<string, Call> calls = new(StringComparer.Ordinal);
    private readonly HashSet<string> resolved = new(StringComparer.Ordinal);
    internal IEnumerable<Call> Pending => calls.Values.Where(call => !resolved.Contains(call.Id));
    internal AgentToolCalls(JsonObject input)
    {
        foreach (var message in input["messages"] as JsonArray ?? [])
        {
            if (A2UIValidation.Text(message?["role"]) == "tool" && A2UIValidation.Text(message?["toolCallId"]) is { } id) resolved.Add(id);
            foreach (var tool in message?["toolCalls"] as JsonArray ?? [])
            {
                var key = A2UIValidation.Text(tool?["id"]); var name = A2UIValidation.Text(tool?["function"]?["name"]);
                if (key is not null && name is not null) calls[key] = new Call(key, name) { Arguments = A2UIValidation.Text(tool?["function"]?["arguments"]) ?? "" };
            }
        }
    }
    internal void Observe(JsonObject value)
    {
        var id = A2UIValidation.Text(value["toolCallId"]); if (id is null) return;
        switch (A2UIValidation.Text(value["type"]))
        {
            case "TOOL_CALL_START": calls[id] = new Call(id, A2UIValidation.Text(value["toolCallName"]) ?? ""); break;
            case "TOOL_CALL_ARGS": if (calls.TryGetValue(id, out var call)) { call.Arguments += A2UIValidation.Text(value["delta"]) ?? ""; if (call.Arguments.Length > 4 * 1024 * 1024) throw new RuntimeRequestException(502, "Tool arguments exceed size limit"); } break;
            case "TOOL_CALL_RESULT": resolved.Add(id); break;
        }
    }
    internal static JsonObject Result(string id, string content) => new() { ["type"] = "TOOL_CALL_RESULT", ["messageId"] = Guid.NewGuid().ToString(), ["toolCallId"] = id, ["content"] = content };
}

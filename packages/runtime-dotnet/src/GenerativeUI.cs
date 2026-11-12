using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace CopilotKit.Intelligence;

/// <summary>
/// Generative UI: the agent renders A2UI 1.0 surfaces from the catalog that the client sends in
/// <c>forwardedProps.copilotkit.ui</c>. Leave <see cref="RuntimeOptions.GenerativeUI"/> null to turn it on
/// only for a run whose client sends a "tool" catalog. Set it to turn it on for every run of
/// <see cref="Agents"/> (all agents when null), or set <see cref="Enabled"/> to false to turn it off.
/// </summary>
public sealed class GenerativeUIOptions
{
    /// <summary>False turns generative UI off for every run, also for a client that asks for it.</summary>
    public bool Enabled { get; init; } = true;
    /// <summary>The agents that get generative UI. Null means all agents.</summary>
    public IReadOnlyList<string>? Agents { get; init; }
    /// <summary>The A2UI version that every agent speaks: "1.0" (the agent gets <c>render_ui</c>) or "0.9" (the agent gets <c>render_a2ui</c>).</summary>
    public string A2UIVersion { get; init; } = "1.0";
    /// <summary>The A2UI version of each agent. When set, it replaces <see cref="A2UIVersion"/>, and an agent that is not in it speaks "1.0".</summary>
    public IReadOnlyDictionary<string, string>? A2UIVersions { get; init; }
    // The remaining options configure the A2UI v0.9 middleware of 0.9 agents only.
    /// <summary>The A2UI v0.9 component schema. It replaces the schema that the runtime builds from the client's catalog.</summary>
    public JsonNode? Schema { get; init; }
    /// <summary>Whether a 0.9 agent gets the render tool. Null adds it when the client sends a "tool" catalog.</summary>
    public bool? InjectA2UITool { get; init; }
    /// <summary>The name of the injected v0.9 render tool.</summary>
    public string A2UIToolName { get; init; } = "render_a2ui";
    /// <summary>The tool names that the v0.9 middleware renders. Null means <c>render_a2ui</c>.</summary>
    public IReadOnlyList<string>? A2UIToolNames { get; init; }
    public string? DefaultCatalogId { get; init; }
    public bool ShowProgressTokens { get; init; } = true;
    public int MaxAttempts { get; init; } = 3;
    public string? DebugExposure { get; init; }

    /// <summary>Reads the TypeScript <c>generativeUI</c> runtime option: true, false, or an options object.</summary>
    public static GenerativeUIOptions? FromJson(JsonNode? value)
    {
        if (value is null) return null;
        if (JsonText.IsBool(value)) return new GenerativeUIOptions { Enabled = value.GetValue<bool>() };
        if (value is not JsonObject options) throw new ArgumentException("generativeUI must be a boolean or an object.");
        var inject = options["injectA2UITool"];
        var recovery = options["recovery"] as JsonObject;
        return new GenerativeUIOptions
        {
            Agents = options["agents"] is JsonArray agents ? agents.Select(agent => JsonText.Str(agent) ?? throw new ArgumentException("generativeUI.agents must be strings.")).ToList() : null,
            A2UIVersion = JsonText.Str(options["a2uiVersion"]) ?? "1.0",
            A2UIVersions = options["a2uiVersion"] is JsonObject versions ? versions.ToDictionary(pair => pair.Key, pair => JsonText.Str(pair.Value) ?? "", StringComparer.Ordinal) : null,
            Schema = options["schema"]?.DeepClone(),
            InjectA2UITool = inject is null ? null : JsonText.IsBool(inject) ? inject.GetValue<bool>() : true,
            A2UIToolName = JsonText.Str(inject) ?? "render_a2ui",
            A2UIToolNames = options["a2uiToolNames"] is JsonArray names ? names.Select(name => JsonText.Str(name) ?? throw new ArgumentException("generativeUI.a2uiToolNames must be strings.")).ToList() : null,
            DefaultCatalogId = JsonText.Str(options["defaultCatalogId"]),
            ShowProgressTokens = recovery?["showProgressTokens"]?.GetValue<bool>() ?? true,
            MaxAttempts = recovery?["maxAttempts"]?.GetValue<int>() ?? 3,
            DebugExposure = JsonText.Str(recovery?["debugExposure"])
        };
    }

    internal void Validate()
    {
        IEnumerable<string> versions = A2UIVersions is null ? [A2UIVersion] : A2UIVersions.Values;
        if (versions.Any(version => version is not ("0.9" or "1.0"))) throw new ArgumentException("A2UIVersion must be \"0.9\" or \"1.0\".");
        if (MaxAttempts < 1 || string.IsNullOrWhiteSpace(A2UIToolName) || DebugExposure is not (null or "hidden" or "collapsed" or "verbose")) throw new ArgumentException("Invalid generative UI configuration.");
    }

    /// <summary>The A2UI version of one agent.</summary>
    internal string VersionOf(string agentId)
    {
        var version = A2UIVersions is null ? A2UIVersion : A2UIVersions.GetValueOrDefault(agentId);
        return version == "0.9" ? "0.9" : "1.0";
    }
}

/// <summary>A function of the A2UI basic catalog (or a CopilotKit addition), callable by the UI.</summary>
internal sealed record BasicFunction(string Description, string Parameters, string ReturnType, bool RequiresUserActivation = false);

/// <summary>What the client renders: its catalog, functions, targets and surfaces.</summary>
internal sealed record GenerativeUIManifest(
    string CatalogId, IReadOnlyList<string> CatalogIds, JsonObject Components, JsonObject Functions,
    JsonArray Targets, JsonObject Surfaces, string Transport, bool HasComponents, JsonObject? Action);

/// <summary>The component names that one target takes.</summary>
internal sealed record AllowedComponents(string Target, IReadOnlyList<string> Names);

/// <summary>
/// Generative UI (A2UI 1.0) contracts. Ports the TypeScript runtime's generative UI helpers
/// (<c>a2ui-envelope.ts</c>, <c>child-refs.ts</c>, <c>validate-operation.ts</c>, <c>prompt.ts</c>).
/// The browser sends its catalog in <c>forwardedProps.copilotkit.ui</c>; nothing in it is trusted.
/// </summary>
internal static class GenerativeUI
{
    internal const string Version = "1.0";
    internal const string ActivityType = "generative-ui-surface";
    internal const string RenderTool = "render_ui";
    internal const string ChatTarget = "chat";
    internal const string ContextDescription = "Generative UI guide: available components, functions, targets, and how to call render_ui.";
    internal const string StandardCatalogId = "copilotkit/standard@1";
    internal const string ComponentIdRef = "common_types.json#/$defs/ComponentId";
    internal const string ChildListRef = "common_types.json#/$defs/ChildList";
    // The agent may not call renderer functions yet (`GENERATIVE_UI_AGENT_FUNCTION_CALLS`).
    private const string AgentFunctionCallsOffReason = "callRendererFunction is not supported in this version: the agent cannot call renderer functions until their results can be sent back to it reliably";
    private const int EnvelopeFormat = 3;
    private const int MaxTargetComponents = 100;
    private const int MaxSummaryRejections = 20;
    internal const int MaxRejectionLength = 500;
    private const int MaxUserValuesLength = 500;
    private const string IndexFunction = "@index";

    internal static string SurfaceMessageId(string surfaceId) => "genui:" + surfaceId;

    // ---------------------------------------------------------------------
    // Built-in functions (`basic-functions.ts`)

    internal static readonly IReadOnlyList<KeyValuePair<string, BasicFunction>> A2UIBasicFunctions =
    [
        new("required", new("Valid when the value is not empty", "{ value: unknown }", "validationResult")),
        new("regex", new("Valid when the value matches the pattern", "{ value: string; pattern: string }", "validationResult")),
        new("length", new("Valid when the length of the value is within min and max", "{ value: string; min?: number; max?: number }", "validationResult")),
        new("numeric", new("Valid when the value is a number within min and max", "{ value: number; min?: number; max?: number }", "validationResult")),
        new("email", new("Valid when the value is an email address", "{ value: string }", "validationResult")),
        new("formatString", new("Interpolates ${/path}, ${relative/path} and ${fn(arg: value)} in the value; \\${ is a literal", "{ value: string }", "string")),
        new("formatNumber", new("The number in the locale of the user", "{ value: number; decimals?: number; grouping?: boolean }", "string")),
        new("formatCurrency", new("The amount as money, with an ISO 4217 currency code", "{ value: number; currency: string; decimals?: number; grouping?: boolean }", "string")),
        new("formatDate", new("A date or ISO string in a TR35 pattern, for example \"MMM d, yyyy\" or \"HH:mm\"", "{ value: string | number; format: string }", "string")),
        new("pluralize", new("The string of the plural category of the value", "{ value: number; zero?: string; one?: string; two?: string; few?: string; many?: string; other: string }", "string")),
        new("openUrl", new("Opens an http(s) URL in a new tab. Only from an event", "{ url: string }", "void", RequiresUserActivation: true)),
        new("and", new("True when every value is true", "{ values: boolean[] }", "boolean")),
        new("or", new("True when any value is true", "{ values: boolean[] }", "boolean")),
        new("not", new("The negated value", "{ value: boolean }", "boolean")),
    ];
    private static readonly IReadOnlyList<KeyValuePair<string, BasicFunction>> CopilotKitFunctions =
    [
        new("calc", new("The value of an arithmetic expression over the other args, by name: + - * / % ( ), x ^ y (power), comparisons, && || !, cond ? a : b, min max round floor ceil abs pow sqrt exp ln log10, the constants pi and e, 'text' + name", "{ expression: string; [name: string]: number | string | boolean }", "any")),
        new("series", new("A list of count copies of item, for chart data and template lists. Put arithmetic in ${expression} strings in item, using the loop variable (default i, counting from start, default 1) and other named args. A whole-expression string retains the result type, so \"${i * monthlyCost}\" yields a number. Arguments, including nested calc or formatString calls in item, resolve before the series loop; those calls cannot use the loop variable. Example: {\"@call\":\"series\",\"args\":{\"count\":6,\"item\":{\"month\":\"${i}\",\"cost\":\"${i * monthlyCost}\"},\"monthlyCost\":{\"@path\":\"/monthlyCost\"}}}. Omit variable to use i.", "{ count: number; item: unknown; variable?: string; start?: number; [name: string]: unknown }", "array")),
    ];
    private static readonly Dictionary<string, BasicFunction> Functions = A2UIBasicFunctions.Concat(CopilotKitFunctions).ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);

    internal static bool IsBasicFunction(string name) => name == IndexFunction || Functions.ContainsKey(name);
    private static bool IsValueFunction(string name) => name == IndexFunction || Functions.TryGetValue(name, out var info) && !info.RequiresUserActivation;
    private static readonly string ValueFunctionList = "@index and the built-in functions (" + string.Join(", ", A2UIBasicFunctions.Concat(CopilotKitFunctions).Select(pair => pair.Key).Where(IsValueFunction)) + ")";

    /// <summary>Who may call an app function, as (renderer, agent). An undeclared caller is the renderer.</summary>
    internal static (bool Renderer, bool Agent) FunctionCallers(JsonObject function)
    {
        if (JsonText.Truthy(function["requiresUserActivation"])) return (true, false);
        var callers = JsonText.Truthy(function["allowedCallers"]) ? function["allowedCallers"] : JsonValue.Create("rendererOnly");
        return (JsonText.Str(callers) != "agentOnly", JsonText.Str(callers) != "rendererOnly");
    }

    // ---------------------------------------------------------------------
    // Envelope (`a2ui-envelope.ts`)

    private static bool OptionalString(JsonObject record, string key) => !record.TryGetPropertyValue(key, out var value) || JsonText.IsString(value);
    private static bool RecordOf(JsonNode? value, Func<JsonNode?, bool> check) => value is JsonObject record && record.All(pair => check(pair.Value));
    private static bool IsSchemaEntry(JsonNode? value) => value is JsonObject record && record["parameters"] is JsonObject && OptionalString(record, "description");
    private static bool IsPropsSchema(JsonNode? value) => value is JsonObject record
        && (!record.TryGetPropertyValue("properties", out var properties) || properties is JsonObject)
        && (!record.TryGetPropertyValue("required", out var required) || required is JsonArray names && names.All(JsonText.IsString));

    private static bool IsComponentManifest(JsonNode? value)
    {
        if (value is not JsonObject record || !IsPropsSchema(record["props"]) || !OptionalString(record, "description")
            || record.ContainsKey("events") && !RecordOf(record["events"], IsSchemaEntry)
            || record.ContainsKey("slots") && !RecordOf(record["slots"], kind => JsonText.Str(kind) is "single" or "multiple")) return false;
        if (!record.TryGetPropertyValue("parameterOrder", out var order)) return true;
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var source in new[] { record["props"]!["properties"], record["slots"], record["events"] })
            if (source is JsonObject entries) keys.UnionWith(entries.Select(pair => pair.Key));
        return order is JsonArray list && list.All(key => JsonText.Str(key) is { } name && keys.Contains(name))
            && list.Select(JsonText.Str).Distinct(StringComparer.Ordinal).Count() == list.Count;
    }

    private static bool IsInlineCatalog(JsonNode? value) => value is JsonObject record
        && JsonText.NonEmpty(record["catalogId"]) && JsonText.Str(record["protocolVersion"]) == "1.0"
        && (!record.ContainsKey("components") || RecordOf(record["components"], IsComponentManifest))
        && RecordOf(record["functions"], IsSchemaEntry) && OptionalString(record, "instructions");

    private static bool IsCapabilities(JsonNode? value) => value is JsonObject record
        && record["supportedCatalogIds"] is JsonArray { Count: > 0 } ids && ids.All(JsonText.NonEmpty)
        && (!record.TryGetPropertyValue("inlineCatalogs", out var catalogs) || catalogs is JsonArray list && list.All(IsInlineCatalog));

    private static bool IsTarget(JsonNode? value) => value is JsonObject record
        && JsonText.NonEmpty(record["id"]) && JsonText.Str(record["kind"]) is "chat" or "inline" && OptionalString(record, "description")
        && (!record.TryGetPropertyValue("components", out var components) || components is JsonArray names && names.Count <= MaxTargetComponents && names.All(JsonText.NonEmpty));

    private static bool IsSurfaceEntry(JsonNode? value) => value is JsonObject record
        && JsonText.NonEmpty(record["target"])
        && (!record.ContainsKey("dataModel") || record["dataModel"] is JsonObject)
        && (!record.TryGetPropertyValue("rejected", out var rejected) || rejected is JsonArray list && list.Count <= MaxSummaryRejections && list.All(entry => JsonText.Str(entry) is { Length: <= MaxRejectionLength }))
        && (!record.TryGetPropertyValue("status", out var status) || JsonText.Str(status) is "deleted" or "failed");

    private static bool IsExtensions(JsonNode? value) => value is JsonObject record
        && JsonText.IsNumber(record["copilotkit_format"]) && JsonText.Number(record["copilotkit_format"]!) == EnvelopeFormat
        && JsonText.Str(record["copilotkit_transport"]) is "tool" or "markdown"
        && record["copilotkit_targets"] is JsonArray targets && targets.All(IsTarget)
        && RecordOf(record["copilotkit_surfaces"], IsSurfaceEntry)
        && JsonText.IsBool(record["copilotkit_contextSent"]);

    /// <summary>The generative UI envelope of <c>forwardedProps</c>, or null when it is missing or malformed.</summary>
    internal static JsonObject? ReadEnvelope(JsonNode? forwardedProps) =>
        forwardedProps?["copilotkit"] is JsonObject ns && ns["ui"] is JsonObject envelope
        && IsCapabilities(envelope["1.0"]) && envelope["metadata"] is JsonObject metadata && IsExtensions(metadata["extensions"])
            ? envelope : null;

    internal static JsonObject Extensions(JsonObject envelope) => (JsonObject)envelope["metadata"]!["extensions"]!;
    internal static string? Transport(JsonNode? forwardedProps) => ReadEnvelope(forwardedProps) is { } envelope ? JsonText.Str(Extensions(envelope)["copilotkit_transport"]) : null;

    /// <summary>Turn an envelope from <see cref="ReadEnvelope"/> into the manifest of the run.</summary>
    internal static GenerativeUIManifest ToManifest(JsonObject envelope)
    {
        var capabilities = (JsonObject)envelope["1.0"]!;
        var ids = capabilities["supportedCatalogIds"]!.AsArray().Select(id => JsonText.Str(id)!).ToList();
        var catalog = (capabilities["inlineCatalogs"] as JsonArray ?? []).OfType<JsonObject>().FirstOrDefault(entry => JsonText.Str(entry["catalogId"]) == ids[0]);
        var extensions = Extensions(envelope);
        return new GenerativeUIManifest(
            ids[0], ids, catalog?["components"] as JsonObject ?? [], catalog?["functions"] as JsonObject ?? [],
            (JsonArray)extensions["copilotkit_targets"]!, (JsonObject)extensions["copilotkit_surfaces"]!,
            JsonText.Str(extensions["copilotkit_transport"])!, catalog?.ContainsKey("components") == true,
            extensions["copilotkit_action"] as JsonObject);
    }

    /// <summary>The manifest of a "tool" run whose catalog has components; otherwise the run passes.</summary>
    internal static GenerativeUIManifest? ReadToolManifest(JsonNode? forwardedProps)
    {
        if (ReadEnvelope(forwardedProps) is not { } envelope) return null;
        var manifest = ToManifest(envelope);
        return manifest.Transport == "tool" && manifest.HasComponents ? manifest : null;
    }

    // ---------------------------------------------------------------------
    // Runtime option (`configureAgentForRequest`, `resolveGenerativeUIInfo`)

    /// <summary>
    /// Whether a run gets generative UI: on for a run with a "tool" envelope, and for every run when
    /// the option turns it on. A "markdown" envelope gets no render tool. Disabled and the agents filter always win.
    /// </summary>
    internal static bool IsRun(GenerativeUIOptions? option, string agentId, JsonNode? forwardedProps)
    {
        if (option is { Enabled: false }) return false;
        var transport = Transport(forwardedProps);
        if (transport != "tool" && (transport == "markdown" || option is null)) return false;
        return option?.Agents is null || option.Agents.Contains(agentId);
    }

    /// <summary>The A2UI version of one agent; "1.0" unless the option says "0.9".</summary>
    internal static string ResolveVersion(GenerativeUIOptions? option, string agentId) => option?.VersionOf(agentId) ?? "1.0";

    /// <summary>The v0.9 middleware of a run: full options for a 0.9 agent, extraction only for 1.0.</summary>
    internal static A2UIOptions A2UIOptionsFor(GenerativeUIOptions? option, string version, JsonNode? forwardedProps)
    {
        if (version != "0.9") return new A2UIOptions();
        option ??= new GenerativeUIOptions();
        return new A2UIOptions
        {
            InjectTool = option.InjectA2UITool ?? Transport(forwardedProps) == "tool",
            ToolName = option.A2UIToolName,
            ToolNames = option.A2UIToolNames?.ToHashSet(StringComparer.Ordinal),
            Schema = option.Schema?.DeepClone(),
            DefaultCatalogId = option.DefaultCatalogId,
            ShowProgressTokens = option.ShowProgressTokens,
            MaxAttempts = option.MaxAttempts,
            DebugExposure = option.DebugExposure
        };
    }

    /// <summary>The <c>generativeUI</c> field of <c>/info</c>.</summary>
    internal static JsonObject Info(GenerativeUIOptions? option)
    {
        if (option is { Enabled: false }) return new JsonObject { ["enabled"] = false };
        var info = new JsonObject { ["enabled"] = true };
        if (option?.Agents is { } agents) info["agents"] = new JsonArray(agents.Select(agent => (JsonNode?)JsonValue.Create(agent)).ToArray());
        return info;
    }

    // ---------------------------------------------------------------------
    // Component references (`child-refs.ts`)

    internal static string? ChildRefKind(JsonObject schema) => JsonText.Str(schema["$ref"]) switch
    {
        ComponentIdRef => "single",
        ChildListRef => "multiple",
        _ => null
    };

    /// <summary>Every component reference in a props schema, with its path ("*" for array items).</summary>
    internal static List<(string[] Path, string Kind)> CollectChildRefs(JsonNode? schema)
    {
        var refs = new List<(string[] Path, string Kind)>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        void Add(string[] path, string kind) { if (seen.Add(PathKey(path))) refs.Add((path, kind)); }
        void Visit(JsonNode? node, string[] path)
        {
            if (node is not JsonObject record) return;
            if (ChildRefKind(record) is { } kind) { Add(path, kind); return; }
            foreach (var variants in new[] { record["anyOf"], record["oneOf"] })
            {
                if (variants is not JsonArray { Count: > 0 } list) continue;
                var kinds = list.Select(variant => variant is JsonObject entry ? ChildRefKind(entry) : null).ToList();
                if (kinds[0] is { } first && kinds.All(entry => entry == first)) Add(path, first);
                else if (kinds.All(entry => entry is null))
                {
                    // A nested reference counts only when every alternative has it.
                    var perVariant = list.Select(CollectChildRefs).ToList();
                    foreach (var (refPath, refKind) in perVariant[0])
                        if (perVariant.All(other => other.Any(entry => entry.Kind == refKind && PathKey(entry.Path) == PathKey(refPath)))) Add([.. path, .. refPath], refKind);
                }
            }
            if (record["allOf"] is JsonArray all) foreach (var variant in all) Visit(variant, path);
            if (record["properties"] is JsonObject properties) foreach (var (key, value) in properties) Visit(value, [.. path, key]);
            if (record["items"] is JsonObject items) Visit(items, [.. path, "*"]);
        }
        Visit(schema, []);
        return refs;
    }

    private static string PathKey(string[] path) => path.Length + ":" + string.Join('\u0001', path);

    // ---------------------------------------------------------------------
    // Operation validation (`validate-operation.ts`)

    private static readonly string[] OperationKinds = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface", "callRendererFunction"];
    private const string V09PathReason = "bind data with {\"@path\": \"/x\"}, not {\"path\": \"/x\"}";
    private static readonly HashSet<string> ForbiddenSegments = new(StringComparer.Ordinal) { "__proto__", "constructor", "prototype" };
    private static readonly string[] AccessibilityKeys = ["label", "description", "live", "hidden"];
    private static readonly string[] LiveValues = ["off", "polite", "assertive"];

    private sealed record Validation(GenerativeUIManifest Manifest, ICollection<string> KnownSurfaces, ICollection<string> CreatedSurfaces, JsonObject? Functions, AllowedComponents? Allowed);

    /// <summary>The one operation key of <paramref name="op"/>, when it has exactly one.</summary>
    internal static string? OperationKind(JsonNode? op)
    {
        if (op is not JsonObject record) return null;
        var kinds = OperationKinds.Where(record.ContainsKey).ToList();
        return kinds.Count == 1 ? kinds[0] : null;
    }

    /// <summary>The <c>surfaceId</c> of a surface operation.</summary>
    internal static string? OperationSurfaceId(JsonNode? op) => OperationKind(op) is { } kind && op![kind] is JsonObject payload ? JsonText.Str(payload["surfaceId"]) : null;

    private static bool IsPathBinding(JsonNode? value) => value is JsonObject record && record.Count == 1 && JsonText.IsString(record["@path"]);
    private static bool IsV09PathBinding(JsonNode? value) => value is JsonObject record && record.Count == 1 && JsonText.IsString(record["path"]);
    private static bool IsCallBinding(JsonNode? value) => value is JsonObject record && JsonText.IsString(record["@call"]);

    private static bool IsIndexCall(JsonNode? value)
    {
        if (value is not JsonObject record || JsonText.Str(record["@call"]) != IndexFunction) return false;
        if (record.Any(pair => pair.Key is not ("@call" or "args"))) return false;
        if (!record.ContainsKey("args")) return true;
        return record["args"] is JsonObject args && args.All(pair => pair.Key == "offset") && (!args.ContainsKey("offset") || JsonText.IsNumber(args["offset"]));
    }

    /// <summary><c>String(value)</c> for the rejection reasons.</summary>
    private static string JsString(JsonNode? value) => value switch
    {
        null => "null",
        JsonObject => "[object Object]",
        JsonArray array => string.Join(',', array.Select(item => item is null ? "" : JsString(item))),
        _ => JsonText.Str(value) ?? value.ToJsonString()
    };

    /// <summary>Check one A2UI 1.0 operation from the model. Returns the rejection reason, or null.</summary>
    internal static string? ValidateOperation(JsonNode? op, GenerativeUIManifest manifest, ICollection<string> knownSurfaces, ICollection<string>? createdSurfaces = null, JsonObject? functions = null, AllowedComponents? allowed = null)
    {
        var options = new Validation(manifest, knownSurfaces, createdSurfaces ?? [], functions, allowed);
        if (op is not JsonObject record) return "operation must be a JSON object";
        if (!record.TryGetPropertyValue("version", out var version) || JsonText.Str(version) != Version)
            return JsonText.Str(version) is { } text ? $"unsupported version \"{text}\"; use \"{Version}\"" : $"operation needs \"version\":\"{Version}\"";
        var kind = OperationKind(record);
        if (kind is null) return "operation must contain exactly one of " + string.Join(", ", OperationKinds);
        if (kind == "callRendererFunction") return AgentFunctionCallsOffReason;
        if (record[kind] is not JsonObject payload || !JsonText.NonEmpty(payload["surfaceId"])) return $"{kind}.surfaceId is required";
        var surfaceId = JsonText.Str(payload["surfaceId"])!;
        if (kind == "createSurface") return CreateSurfaceProblem(payload, surfaceId, options);
        if (!knownSurfaces.Contains(surfaceId)) return $"surface \"{surfaceId}\" does not exist; send createSurface first";
        if (kind == "updateDataModel") return DataModelProblem(payload);
        if (kind == "updateComponents") return ComponentsProblem(payload["components"], "updateComponents.components", options);
        return null;
    }

    /// <summary>A <c>catalogId</c> can name the catalog of the run or one of its bases.</summary>
    private static string? CatalogProblem(bool present, JsonNode? catalogId, GenerativeUIManifest manifest)
    {
        var ids = manifest.CatalogIds.Count > 0 ? manifest.CatalogIds : [manifest.CatalogId];
        if (!present || JsonText.Str(catalogId) is { } id && ids.Contains(id)) return null;
        var names = string.Join(", ", ids.Select(entry => $"\"{entry}\""));
        var use = ids.Count == 1 ? names : "one of: " + names;
        return $"unknown catalog \"{JsString(catalogId)}\"; leave out catalogId or use {use}";
    }

    private static string? CreateSurfaceProblem(JsonObject payload, string surfaceId, Validation options)
    {
        if (options.KnownSurfaces.Contains(surfaceId)) return $"surface \"{surfaceId}\" already exists";
        if (options.CreatedSurfaces.Contains(surfaceId)) return $"surface id \"{surfaceId}\" was used before; use a new surfaceId";
        if (CatalogProblem(payload.TryGetPropertyValue("catalogId", out var catalogId), catalogId, options.Manifest) is { } reason) return reason;
        if (payload.ContainsKey("dataModel") && payload["dataModel"] is not JsonObject) return "createSurface.dataModel must be a JSON object";
        if (!payload.ContainsKey("components")) return null;
        return ComponentsProblem(payload["components"], "createSurface.components", options);
    }

    private static string? DataModelProblem(JsonObject payload)
    {
        if (!payload.ContainsKey("value")) return "updateDataModel.value is required; use \"value\":null to delete";
        var pathNode = payload["path"];
        var path = pathNode is null ? "/" : JsonText.Str(pathNode);
        if (path is null || !path.StartsWith('/')) return "updateDataModel.path must be an absolute JSON pointer";
        if (path == "/") return payload["value"] is JsonObject ? null : "a root updateDataModel value must be a JSON object";
        return PathProblem(path, "updateDataModel.path");
    }

    /// <summary>Check the segments of an absolute pointer or of a template-relative path.</summary>
    private static string? PathProblem(string path, string label)
    {
        var segments = (path.StartsWith('/') ? path[1..] : path).Split('/');
        if (segments.Any(segment => segment.Length == 0)) return $"{label} must not contain empty segments";
        foreach (var segment in segments)
        {
            var decoded = Regex.Replace(segment, "~([01])", match => match.Groups[1].Value == "1" ? "/" : "~");
            if (ForbiddenSegments.Contains(decoded)) return $"path segment \"{decoded}\" is not allowed in {label}";
        }
        return null;
    }

    private static string? ComponentsProblem(JsonNode? components, string label, Validation options)
    {
        if (components is not JsonArray { Count: > 0 } list) return $"{label} must be a non-empty array";
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var node in list)
        {
            if (node is not JsonObject record) return "component must be a JSON object";
            if (JsonText.Str(record["id"]) is not { Length: > 0 } identifier) return "id is required";
            if (NodeProblem(record, identifier, options) is { } reason) return $"component \"{identifier}\": {reason}";
            if (!ids.Add(identifier)) return $"component \"{identifier}\" appears twice in one update";
        }
        return null;
    }

    private static string? NodeProblem(JsonObject node, string identifier, Validation options)
    {
        if (JsonText.Str(node["component"]) is not { } name) return "component type is required";
        if (options.Manifest.Components[name] is not JsonObject entry) return $"unknown component \"{name}\"";
        if (options.Allowed is { } allowed && !allowed.Names.Contains(name))
        {
            var names = allowed.Names.Count > 0 ? string.Join(", ", allowed.Names) : "none";
            return $"\"{name}\" is not allowed in target \"{allowed.Target}\"; use one of: {names}";
        }
        var props = (JsonObject)entry["props"]!;
        var propNames = props["properties"] is JsonObject properties ? properties.Select(pair => pair.Key).ToHashSet(StringComparer.Ordinal) : [];
        var events = JsonText.Truthy(entry["events"]) ? entry["events"] as JsonObject ?? [] : [];
        var slots = JsonText.Truthy(entry["slots"]) ? entry["slots"] as JsonObject ?? [] : [];
        foreach (var (key, value) in node)
        {
            if (key is "id" or "component") continue;
            if (key == "catalogId")
            {
                if (CatalogProblem(true, value, options.Manifest) is { } catalog) return $"{key}: {catalog}";
                continue;
            }
            if (key == "metadata")
            {
                if (!(value is JsonObject metadata && (!metadata.ContainsKey("extensions") || metadata["extensions"] is JsonObject))) return "metadata must be { \"extensions\": { ... } }";
                continue;
            }
            if (key == "accessibility")
            {
                if (AccessibilityProblem(value) is { } accessibility) return $"{key}: {accessibility}";
                continue;
            }
            if (events.ContainsKey(key))
            {
                if (ActionBindingProblem(value, options) is { } action) return $"{key}: {action}";
                continue;
            }
            if (slots.TryGetPropertyValue(key, out var slot) && slot is not null)
            {
                if (SlotProblem(value, JsonText.Str(slot) ?? "", identifier) is { } slotReason) return $"{key}: {slotReason}";
                continue;
            }
            if (!propNames.Contains(key)) return $"unknown prop \"{key}\"";
            if (IsV09PathBinding(value)) return $"{key}: {V09PathReason}";
            if (ForbiddenCall(value) is { } call) return $"{key}: {call}; a data prop can call only {ValueFunctionList}";
        }
        foreach (var reference in CollectChildRefs(props))
            if (ChildRefProblem(node, reference, identifier) is { } reason) return reason;
        foreach (var prop in props["required"] as JsonArray ?? [])
            if (JsonText.Str(prop) is { } required && !node.ContainsKey(required)) return $"missing required prop \"{required}\"";
        return null;
    }

    private static string? AccessibilityProblem(JsonNode? value)
    {
        if (value is not JsonObject record) return "must be { \"label\": \"...\", \"description\": \"...\", \"live\": \"polite\", \"hidden\": false }";
        foreach (var (key, entry) in record)
        {
            if (!AccessibilityKeys.Contains(key)) return $"unknown key \"{key}\"";
            if (IsV09PathBinding(entry)) return $"{key}: {V09PathReason}";
            if (IsPathBinding(entry) || IsCallBinding(entry))
            {
                if (ForbiddenCall(entry) is { } call) return $"{key}: {call}";
                continue;
            }
            if (key == "live") { if (JsonText.Str(entry) is not { } live || !LiveValues.Contains(live)) return "live must be one of " + string.Join(", ", LiveValues); }
            else if (key == "hidden") { if (!JsonText.IsBool(entry)) return "hidden must be a boolean"; }
            else if (!JsonText.IsString(entry)) return $"{key} must be a string";
        }
        return null;
    }

    private static string? ActionBindingProblem(JsonNode? value, Validation options)
    {
        if (value is not JsonObject record) return "must be an action object";
        if (record.Count != 1 || record.First().Key is not ("functionCall" or "event")) return "must be { \"event\": ... } or { \"functionCall\": ... }";
        return record.ContainsKey("functionCall") ? FunctionCallProblem(record["functionCall"], "functionCall", options) : EventProblem(record["event"]);
    }

    private static string? FunctionCallProblem(JsonNode? call, string label, Validation options)
    {
        if (call is not JsonObject record) return label + " must be { \"@call\": \"<function>\", \"args\": { ... } }";
        if (JsonText.Str(record["@call"]) is not { Length: > 0 } name)
            return JsonText.IsString(record["call"]) ? $"{label} names the function with \"@call\", not \"call\"" : $"{label}[\"@call\"] must be a function name";
        if (record.ContainsKey("args") && record["args"] is not JsonObject) return $"{label}.args must be an object";
        if (CatalogProblem(record.TryGetPropertyValue("catalogId", out var catalogId), catalogId, options.Manifest) is { } catalog) return $"{label}: {catalog}";
        foreach (var (key, arg) in record["args"] as JsonObject ?? [])
            if (IsV09PathBinding(arg)) return $"{label}.args.{key}: {V09PathReason}";
        // A function the app declares under a built-in name is the app's own.
        var appFunctions = options.Functions;
        var declared = appFunctions?[name] as JsonObject;
        var builtIn = declared is null ? Functions.GetValueOrDefault(name) : null;
        if (declared is null && builtIn is null) return appFunctions is null ? null : $"function \"{name}\" is not exposed to generative UI";
        if (declared is null && appFunctions is null) return null;
        var (renderer, agent) = declared is not null ? FunctionCallers(declared) : (true, false);
        var fromAgent = label.StartsWith("callRendererFunction", StringComparison.Ordinal);
        if (fromAgent && !agent)
        {
            var userActivation = declared is not null ? JsonText.Truthy(declared["requiresUserActivation"]) : builtIn!.RequiresUserActivation;
            return userActivation ? $"function \"{name}\" runs only from a user gesture; the agent cannot call it"
                : $"function \"{name}\" runs only in the UI (allowedCallers \"rendererOnly\"); the agent cannot call it";
        }
        if (!fromAgent && !renderer) return $"function \"{name}\" runs only for the agent (allowedCallers \"agentOnly\"); the UI cannot call it";
        return null;
    }

    private static string? EventProblem(JsonNode? value)
    {
        if (value is not JsonObject record || !JsonText.NonEmpty(record["name"])) return "event.name is required";
        var hasMessage = record.TryGetPropertyValue("userMessage", out var message);
        var isMessage = !hasMessage || JsonText.IsString(message) || IsPathBinding(message) || message is JsonObject call && JsonText.IsString(call["@call"]) && ForbiddenCall(message) is null;
        if (!isMessage) return IsV09PathBinding(message) ? $"event.userMessage: {V09PathReason}" : "event.userMessage must be a string, {\"@path\": \"/x\"} or a function value";
        if (!record.ContainsKey("context")) return null;
        if (record["context"] is not JsonObject context) return "event.context must be an object";
        foreach (var (key, entry) in context)
        {
            if (IsV09PathBinding(entry)) return $"event.context.{key}: {V09PathReason}";
            if (ForbiddenCall(entry) is { } call2) return $"event.context.{key}: {call2}; a context value can call only {ValueFunctionList}";
        }
        return null;
    }

    private static string? SlotProblem(JsonNode? value, string kind, string ownId)
    {
        var isTemplate = value is JsonObject record && record.ContainsKey("componentId");
        if (kind == "single" && isTemplate) return "a template { \"componentId\", \"path\" } is only allowed in a \"multiple\" slot";
        if (kind == "multiple" && isTemplate) return TemplateProblem((JsonObject)value!, ownId);
        if (kind == "multiple" && value is not JsonArray) return "must be an array of component ids or a template { \"componentId\", \"path\" }";
        IEnumerable<JsonNode?> identifiers = kind == "multiple" ? (JsonArray)value! : new[] { value };
        foreach (var identifier in identifiers)
        {
            if (!JsonText.NonEmpty(identifier)) return "must reference component ids (strings)";
            if (JsonText.Str(identifier) == ownId) return "a component cannot be its own child";
        }
        return null;
    }

    private static string? TemplateProblem(JsonObject template, string ownId)
    {
        if (template.Any(pair => pair.Key is not ("componentId" or "path"))) return "a template takes only \"componentId\" and \"path\"";
        if (JsonText.Str(template["componentId"]) is not { Length: > 0 } componentId) return "template componentId must be a component id";
        if (componentId == ownId) return "a component cannot be its own child";
        if (JsonText.Str(template["path"]) is not { Length: > 0 } path) return "template path must be a JSON pointer or a relative path";
        return PathProblem(path, "template path");
    }

    /// <summary>The first function call in a data value that is not a value function, at any depth.</summary>
    private static string? ForbiddenCall(JsonNode? value)
    {
        if (value is JsonArray array)
        {
            foreach (var item in array) if (ForbiddenCall(item) is { } reason) return reason;
            return null;
        }
        if (value is not JsonObject record) return null;
        if (IsIndexCall(record)) return null;
        if (JsonText.Str(record["@call"]) == IndexFunction) return "@index takes only an offset";
        if (JsonText.IsString(record["call"])) return "name the function with \"@call\", not \"call\"";
        if (record.ContainsKey("functionCall")) return "an event binding is not a value";
        if (JsonText.Str(record["@call"]) is { } name)
        {
            if (!IsValueFunction(name)) return IsBasicFunction(name) ? $"\"{name}\" runs only from an event" : $"\"{name}\" is not a basic function";
            if (!record.ContainsKey("args")) return null;
            if (record["args"] is not JsonObject) return $"the args of \"{name}\" must be an object";
            return ForbiddenCall(record["args"]);
        }
        foreach (var (_, item) in record) if (ForbiddenCall(item) is { } reason) return reason;
        return null;
    }

    /// <summary>Check the component ids at one typed reference of a node, at any depth.</summary>
    private static string? ChildRefProblem(JsonObject node, (string[] Path, string Kind) reference, string ownId)
    {
        var label = string.Join('.', reference.Path.Where(step => step != "*"));
        string? Visit(JsonNode? value, int step)
        {
            // A bound or computed value is known only at render.
            if (IsPathBinding(value) || value is JsonObject call && call.ContainsKey("@call")) return null;
            if (step == reference.Path.Length) return SlotProblem(value, reference.Kind, ownId) is { } reason ? $"{label}: {reason}" : null;
            var head = reference.Path[step];
            if (head == "*")
            {
                if (value is not JsonArray items) return null;
                foreach (var item in items) if (Visit(item, step + 1) is { } reason) return reason;
                return null;
            }
            if (value is not JsonObject record || !record.ContainsKey(head)) return null;
            return Visit(record[head], step + 1);
        }
        return Visit(node, 0);
    }

    // ---------------------------------------------------------------------
    // The guide (`prompt.ts`, `prompt-spec.ts`, `schema-render.ts`)

    internal const string WhenToShow = "Show UI when it conveys the answer better than prose: to illustrate a concept (a diagram, a chart of how something changes), to compare options side by side, to let the user explore or adjust values, or to collect input. A small, focused surface next to your explanation often lands better than a long description. Reply in prose alone for a quick fact, a short answer, or conversation, and never add UI only as decoration.";
    private const string ToolIntro = "Call `" + RenderTool + "` to show UI. Arguments: `target` first, then `operations` (A2UI v1.0 operations, applied in order).";

    // Each item is a rule, or rules that apply only when every listed feature holds.
    private sealed record PromptItem(string[] Features, string[] Rules)
    {
        public static implicit operator PromptItem(string rule) => new([], [rule]);
    }

    private static readonly PromptItem[] ToolOperations =
    [
        "{\"version\":\"1.0\",\"createSurface\":{\"surfaceId\":\"<new id>\",\"dataModel\":{...},\"components\":[{\"id\":\"root\",\"component\":\"<Name>\",\"children\":[\"<child id>\"]}]}}: the first operation of a new surface. \"dataModel\" and \"components\" are optional.",
        "{\"version\":\"1.0\",\"updateComponents\":{\"surfaceId\":\"<id>\",\"components\":[<component>, ...]}}: add or replace components by id.",
        "{\"version\":\"1.0\",\"updateDataModel\":{\"surfaceId\":\"<id>\",\"path\":\"/some/path\",\"value\":<json>}}: set the value at \"path\". Always give \"value\". \"value\":null deletes the key at \"path\".",
        "{\"version\":\"1.0\",\"deleteSurface\":{\"surfaceId\":\"<id>\"}}: remove the surface.",
        new(["agentCalls"], ["{\"version\":\"1.0\",\"callRendererFunction\":{\"functionCallId\":\"<unique id>\",\"callFunction\":{\"@call\":\"<function>\",\"args\":{...}}}}: run an app function now, with no click. It needs no surface."]),
    ];

    private static readonly PromptItem[] ToolRules =
    [
        "Components are flat objects: {\"id\":\"...\",\"component\":\"<Name>\", ...props}. Every surface renders from the component with id \"root\". Reference children by id in slot props.",
        "A component may take \"accessibility\":{\"label\":\"<1 to 3 words>\",\"description\":\"<what it does>\"} for screen readers: on the component it describes, when nothing visible names it. Not on every component, and \"live\":\"polite\" only on text that changes by itself.",
        "Stream progressively: put the initial data in \"dataModel\" and the root in \"components\" of the createSurface operation, then send one updateComponents operation per child, so the UI appears while you are still writing. The root must already list the ids of its children in its slot props (for example \"children\":[\"card-1\",\"card-2\"]), even though the children come later. A component that no slot references is never shown.",
        "Updating a component replaces all of its props, so resend every prop.",
        "Prop values are literals or data bindings {\"@path\":\"/data/path\"}. Never write {\"path\":\"/data/path\"} as a binding.",
        new(["events", "functions"], ["Event props take an action. {\"functionCall\":{\"@call\":\"<function>\",\"args\":{...}}} runs an app function in the browser immediately, and you are not told about it. {\"event\":{\"name\":\"<name>\",\"userMessage\":\"<text>\",\"context\":{...}}} sends the interaction back to you as a user message, with \"userMessage\" as its first line. \"userMessage\" is plain text: ${...} is not interpolated in it; put values in \"context\". Only call functions listed below."]),
        new(["events", "noFunctions"], ["Event props take an action: {\"event\":{\"name\":\"<name>\",\"userMessage\":\"<text>\",\"context\":{...}}} sends the interaction back to you as a user message, with \"userMessage\" as its first line. \"userMessage\" is plain text: ${...} is not interpolated in it; put values in \"context\"."]),
        "To show a different view, create a new surface with a new surfaceId (for example, a checkout form after a cart summary). Update an existing surface only when the user asks to change that same view: then do not send createSurface, use its surfaceId, and pass its existing target. Never reuse an earlier chat surface for a different view, because that replaces the earlier UI and anything the user typed into it.",
        "Never use a surfaceId again, also after deleteSurface.",
        "A prop can also be a function value that updates with the data: {\"@call\":\"formatCurrency\",\"args\":{\"value\":{\"@path\":\"/total\"},\"currency\":\"EUR\"}}. Only call functions listed below. formatString interpolates ${/path} and ${fn(arg: value)} in its value.",
        "${...} is evaluated only in the value of formatString and in the item of series; in other strings it stays literal text. Inside formatString, ${...} does not support operators. For arithmetic use calc, with the values as named args: {\"@call\":\"calc\",\"args\":{\"expression\":\"seats * 29 * (annual ? 0.8 : 1)\",\"seats\":{\"@path\":\"/seats\"},\"annual\":{\"@path\":\"/annual\"}}}.",
        "For a computed list (chart data, template items) use series. Its description under Functions gives the rules and an example.",
        new(["checks"], ["Validate an input with \"checks\": [{\"condition\":{\"@call\":\"email\",\"args\":{\"value\":{\"@path\":\"/form/email\"}}},\"message\":\"Enter a valid email\"}]. The check functions are required, regex, length, numeric and email. A failed check shows the message under the input and disables a Button that has the same checks."]),
        new(["templates"], ["To repeat a component for each item of a list, give a multiple slot a template: \"children\":{\"componentId\":\"row\",\"path\":\"/items\"}. Inside the template, paths are relative to the item (\"name\", not \"/name\"). {\"@call\":\"@index\"} gives the position of the item, from 0; {\"@call\":\"@index\",\"args\":{\"offset\":1}} counts from 1."]),
        new(["agentCalls"],
        [
            "Give every callRendererFunction a new functionCallId. Call only a function marked (UI or agent) or (agent only); a function with no mark is for the UI only. A function marked (agent only) is only for callRendererFunction: do not bind an event to it.",
            "The result of a callRendererFunction comes back to you in a new turn, as a developer message: {\"version\":\"1.0\",\"rendererFunctionResponse\":{\"functionCallId\":\"<id>\",\"value\":...}}. If the call failed, it has \"error\" in place of \"value\". Do not wait for the result in this reply, and do not guess it.",
        ]),
    ];

    private static bool HasChildList(JsonNode? schema) => schema switch
    {
        JsonArray array => array.Any(HasChildList),
        JsonObject record => JsonText.Str(record["$ref"]) == ChildListRef || record.Any(pair => HasChildList(pair.Value)),
        _ => false
    };

    /// <summary>Which optional rule groups apply to the manifest (<c>generativeUIGuideFeatures</c>).</summary>
    private static Dictionary<string, bool> PromptFeatures(GenerativeUIManifest manifest)
    {
        var components = manifest.Components.Select(pair => pair.Value as JsonObject).OfType<JsonObject>().ToList();
        var functions = manifest.Functions.Any(pair => !IsBasicFunction(pair.Key));
        return new Dictionary<string, bool>(StringComparer.Ordinal)
        {
            ["functions"] = functions,
            ["noFunctions"] = !functions,
            ["events"] = components.Any(component => component["events"] is JsonObject { Count: > 0 }),
            ["templates"] = components.Any(component => component["slots"] is JsonObject slots && slots.Any(pair => JsonText.Str(pair.Value) == "multiple") || HasChildList(component["props"])),
            ["checks"] = components.Any(component => component["props"]?["properties"] is JsonObject properties && properties.ContainsKey("checks")),
            // `GENERATIVE_UI_AGENT_FUNCTION_CALLS` is off.
            ["agentCalls"] = false,
        };
    }

    private static IEnumerable<string> Select(PromptItem[] items, Dictionary<string, bool> features) =>
        items.Where(item => item.Features.All(feature => features[feature])).SelectMany(item => item.Rules);

    private static string OneLine(string text) => Regex.Replace(text, @"\s*\n\s*", " ");

    /// <summary>The component list of the tool guide, in the "json-schema" notation.</summary>
    private static string ComponentList(JsonObject components) => string.Join("\n", components.Select(pair =>
    {
        var component = pair.Value as JsonObject ?? [];
        var lines = new List<string>
        {
            $"- **{pair.Key}**" + (JsonText.Str(component["description"]) is { Length: > 0 } description ? ": " + OneLine(description) : ""),
            "  props: " + JsonText.Compact(component["props"])
        };
        if (component["events"] is not null) lines.Add("  event props: " + JsonText.Compact(component["events"]));
        if (component["slots"] is not null) lines.Add("  slot props (component ids): " + JsonText.Compact(component["slots"]));
        return string.Join("\n", lines);
    }));

    private static string Shorten(string text) => text.Length > MaxUserValuesLength ? text[..MaxUserValuesLength] + "..." : text;

    /// <summary>The guide the runtime adds to a tool-transport run (<c>buildGenerativeUIPrompt</c>).</summary>
    internal static string BuildPrompt(GenerativeUIManifest manifest)
    {
        var targets = manifest.Targets.OfType<JsonObject>().Select(target =>
        {
            var place = JsonText.Str(target["kind"]) == "chat" ? "inside the chat transcript" : "a named area of the app";
            var limit = target["components"] is JsonArray components
                ? "; only " + (components.Count > 0 ? string.Join(", ", components.Select(JsonText.Str)) : "no components") : "";
            var description = JsonText.Str(target["description"]) is { Length: > 0 } text ? ": " + text : "";
            return $"- \"{JsonText.Str(target["id"])}\" ({place}{limit}){description}";
        }).ToList();
        var functions = manifest.Functions.Select(pair =>
        {
            var function = pair.Value as JsonObject ?? [];
            var parameters = function["parameters"] as JsonObject ?? [];
            // A built-in function carries its short signature in the description of its parameters.
            var signature = JsonText.Str(parameters["description"]);
            var args = signature is not null && signature.StartsWith('{') && parameters.Count == 2 ? signature : JsonText.Compact(parameters);
            var description = JsonText.Str(function["description"]) is { Length: > 0 } text ? ": " + text : "";
            return $"- **{pair.Key}**{description}\n  args: {args}";
        }).ToList();
        var surfaces = manifest.Surfaces.Select(pair =>
        {
            var summary = pair.Value as JsonObject ?? [];
            var state = JsonText.Str(summary["status"]) switch
            {
                "deleted" => ", deleted: never use this id again",
                "failed" => ", not created: send a corrected createSurface with this id",
                _ => ""
            };
            var lines = new List<string> { $"- \"{pair.Key}\" (target \"{JsonText.Str(summary["target"])}\"{state})" };
            if (summary["dataModel"] is not null) lines.Add("  user values: " + Shorten(JsonText.Compact(summary["dataModel"])));
            lines.AddRange((summary["rejected"] as JsonArray ?? []).Select(rejection => "  rejected: " + JsonText.Str(rejection)));
            return string.Join("\n", lines);
        }).ToList();
        var hasNotes = manifest.Surfaces.Any(pair => pair.Value is JsonObject summary && (summary.ContainsKey("dataModel") || summary["rejected"] is JsonArray { Count: > 0 }));
        var notes = hasNotes ? "User values are what the user entered, by path. Your writes to those paths are ignored. Rejected operations were dropped: send them again with the problem fixed.\n" : "";
        var features = PromptFeatures(manifest);
        var operations = string.Join("\n", Select(ToolOperations, features).Select(op => "- " + op));
        var rules = string.Join("\n", Select(ToolRules, features).Select((rule, index) => $"{index + 1}. {rule}"));
        var componentList = ComponentList(manifest.Components);
        return string.Join("\n\n",
            $"## Generative UI\n{ToolIntro}\n\n{WhenToShow}\n\nEvery operation has \"version\":\"1.0\" and exactly one of:\n{operations}\n\nRules:\n{rules}",
            "### Targets\n" + (targets.Count > 0 ? string.Join("\n", targets) : "- none"),
            "### Components\n" + (componentList.Length > 0 ? componentList : "- none"),
            "### Functions\n" + (functions.Count > 0 ? string.Join("\n", functions) : "- none"),
            "### Existing surfaces\n" + notes + (surfaces.Count > 0 ? string.Join("\n", surfaces) : "- none"));
    }
}

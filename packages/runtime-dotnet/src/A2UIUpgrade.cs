using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace CopilotKit.Intelligence;

/// <summary>
/// Serves A2UI v0.9 agents through the A2UI 1.0 client. Ports <c>a2ui-v09-operations.ts</c>,
/// <c>a2ui-v09-actions.ts</c> and <c>a2ui-v09-catalog.ts</c> of the TypeScript runtime:
/// v0.9 <c>a2ui-surface</c> activity events become 1.0 <c>generative-ui-surface</c> events,
/// a click on a converted surface reaches the agent as the v0.9 <c>a2uiAction</c>, and a 0.9 agent
/// gets the v0.9 component schema of the client's catalog.
/// </summary>
internal static class A2UIUpgrade
{
    // -----------------------------------------------------------------------
    // Operations (`a2ui-v09-operations.ts`)

    internal const string V09SurfaceActivityType = "a2ui-surface";
    private const string OperationsKey = "a2ui_operations";
    private static readonly HashSet<string> V09Versions = new(StringComparer.Ordinal) { "v0.9", "v0.9.1" };
    private static readonly string[] V09Kinds = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"];
    private static readonly HashSet<string> V09BasicCatalogIds = new(StringComparer.Ordinal)
    {
        "https://a2ui.org/specification/v0_9/basic_catalog.json",
        "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
    };
    // The A2UI 1.0 basic catalog, which native 1.0 agents (for example ADK) send. It has the 18 components of the
    // v0.9 basic catalog with 1.0 bindings, so it becomes the standard catalog too.
    private static readonly HashSet<string> V10BasicCatalogIds = new(StringComparer.Ordinal)
    {
        "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
    };
    // v0.9 `Text` heading variants as 1.0 `Title` sizes, largest first.
    private static readonly Dictionary<string, string> HeadingSizes = new(StringComparer.Ordinal) { ["h1"] = "2xl", ["h2"] = "xl", ["h3"] = "lg", ["h4"] = "md", ["h5"] = "sm" };

    /// <summary>Why an operation cannot be converted.</summary>
    private sealed class ConversionException(string message) : Exception(message);

    private static string? V09Kind(JsonObject op)
    {
        var kinds = V09Kinds.Where(op.ContainsKey).ToList();
        return kinds.Count == 1 ? kinds[0] : null;
    }

    /// <summary>True for an A2UI v0.9 operation, also one without <c>version</c> but with one v0.9 key.</summary>
    internal static bool IsV09Operation(JsonNode? value)
    {
        if (value is not JsonObject op) return false;
        if (op.TryGetPropertyValue("version", out var version)) return JsonText.Str(version) is { } text && V09Versions.Contains(text);
        return V09Kind(op) is { } kind && op[kind] is JsonObject;
    }

    /// <summary><c>{ path }</c> becomes <c>{ "@path" }</c> and <c>{ call, args }</c> becomes <c>{ "@call", args }</c>.</summary>
    private static JsonNode? ConvertValue(JsonNode? value)
    {
        if (value is JsonArray array) return new JsonArray(array.Select(ConvertValue).ToArray());
        if (value is not JsonObject record) return value?.DeepClone();
        if (record.Count == 1 && JsonText.Str(record["path"]) is { } path) return new JsonObject { ["@path"] = path };
        if (JsonText.IsString(record["call"]) && record.All(pair => pair.Key is "call" or "args" or "returnType")) return ConvertCall(record);
        var result = new JsonObject();
        foreach (var (key, item) in record) result[key] = ConvertValue(item);
        return result;
    }

    private static JsonObject ConvertCall(JsonObject call)
    {
        var result = new JsonObject { ["@call"] = call["call"]!.DeepClone() };
        if (call.ContainsKey("args")) result["args"] = ConvertValue(call["args"]);
        return result;
    }

    private static bool IsV09Action(JsonNode? value) => value is JsonObject record && record.Count == 1 && (record["event"] is JsonObject || record["functionCall"] is JsonObject);

    /// <summary>A v0.9 action as a 1.0 <c>{ event }</c> or <c>{ functionCall }</c> binding.</summary>
    private static JsonObject ConvertAction(JsonNode? action)
    {
        if (!IsV09Action(action)) throw new ConversionException("action must be { \"event\": ... } or { \"functionCall\": ... }");
        if (action!["functionCall"] is JsonObject call)
        {
            if (!JsonText.NonEmpty(call["call"])) throw new ConversionException("action.functionCall.call must be a function name");
            return new JsonObject { ["functionCall"] = ConvertCall(call) };
        }
        var source = (JsonObject)action["event"]!;
        if (!JsonText.NonEmpty(source["name"])) throw new ConversionException("action.event.name is required");
        var converted = new JsonObject { ["name"] = source["name"]!.DeepClone() };
        if (source.ContainsKey("context")) converted["context"] = ConvertValue(source["context"]);
        return new JsonObject { ["event"] = converted };
    }

    private static JsonObject Without(JsonObject node, params string[] keys)
    {
        var result = new JsonObject();
        foreach (var (key, value) in node) if (!keys.Contains(key)) result[key] = value?.DeepClone();
        return result;
    }

    /// <summary>
    /// The props of the basic catalog that the 1.0 standard catalog names differently.
    /// <c>Text</c> with a heading <c>variant</c> becomes <c>Title</c> (h1 "2xl" to h5 "sm"), with <c>caption</c>
    /// it becomes <c>Caption</c>; <c>variant</c> goes, and <c>weight</c> too for Title and Caption.
    /// <c>Button.action</c> becomes <c>onClick</c>. <c>TextField.validationRegexp</c> becomes a <c>regex</c> check.
    /// </summary>
    private static JsonObject BasicCatalogChanges(JsonObject node)
    {
        var component = JsonText.Str(node["component"]);
        if (component == "Text" && node.ContainsKey("variant"))
        {
            var variant = JsonText.Str(node["variant"]);
            if (variant is not null && HeadingSizes.TryGetValue(variant, out var size))
            {
                var title = Without(node, "variant", "weight");
                title["component"] = "Title"; title["size"] = size;
                return title;
            }
            if (variant == "caption")
            {
                var caption = Without(node, "variant", "weight");
                caption["component"] = "Caption";
                return caption;
            }
            return Without(node, "variant");
        }
        if (component == "Button" && node.ContainsKey("action"))
        {
            var rest = Without(node, "action");
            rest["onClick"] = node["action"]?.DeepClone();
            return rest;
        }
        if (component == "TextField" && node.ContainsKey("validationRegexp"))
        {
            var rest = Without(node, "validationRegexp");
            if (JsonText.Str(node["validationRegexp"]) is not { } pattern || !rest.ContainsKey("value")) return rest;
            var check = new JsonObject { ["condition"] = new JsonObject { ["@call"] = "regex", ["args"] = new JsonObject { ["value"] = rest["value"]?.DeepClone(), ["pattern"] = pattern } } };
            var checks = rest["checks"] is JsonArray existing ? existing.Select(item => item?.DeepClone()).ToList() : [];
            checks.Add(check);
            rest["checks"] = new JsonArray(checks.ToArray());
            return rest;
        }
        return node;
    }

    /// <summary>One v0.9 component (flat format) as a 1.0 component node.</summary>
    private static JsonObject ConvertComponent(JsonNode? node)
    {
        if (node is not JsonObject record || JsonText.Str(record["id"]) is not { Length: > 0 } id) throw new ConversionException("a component needs a string id");
        if (!JsonText.NonEmpty(record["component"])) throw new ConversionException($"component \"{id}\": the component type must be a string (the v0.9 flat format)");
        var converted = new JsonObject();
        foreach (var (key, value) in record)
        {
            if (key is "id" or "component") converted[key] = value?.DeepClone();
            else if (key == "action" || IsV09Action(value))
            {
                try { converted[key] = ConvertAction(value); }
                catch (ConversionException error) { throw new ConversionException($"component \"{id}\": {error.Message}"); }
            }
            else converted[key] = ConvertValue(value);
        }
        return BasicCatalogChanges(converted);
    }

    /// <summary>v0.9 removes the key when <c>value</c> is left out; 1.0 removes it for null.</summary>
    private static JsonObject ConvertUpdateDataModel(JsonObject payload, string surfaceId)
    {
        var hasPath = payload.TryGetPropertyValue("path", out var pathNode);
        if (hasPath && !JsonText.IsString(pathNode)) throw new ConversionException("updateDataModel.path must be a string");
        var relative = JsonText.Str(pathNode) ?? "";
        var pointer = relative.StartsWith('/') ? relative : "/" + relative;
        var isRoot = pointer == "/";
        var hasValue = payload.TryGetPropertyValue("value", out var value);
        if (isRoot && hasValue && value is not JsonObject) throw new ConversionException("a root updateDataModel value must be a JSON object in A2UI 1.0");
        return new JsonObject
        {
            ["version"] = GenerativeUI.Version,
            ["updateDataModel"] = new JsonObject { ["surfaceId"] = surfaceId, ["path"] = pointer, ["value"] = hasValue ? value?.DeepClone() : isRoot ? new JsonObject() : null }
        };
    }

    /// <summary>The basic catalog id becomes the standard catalog id; <c>theme</c> has no 1.0 field.</summary>
    private static JsonObject ConvertCreateSurface(JsonObject payload, string surfaceId)
    {
        var create = new JsonObject { ["surfaceId"] = surfaceId };
        if (JsonText.Str(payload["catalogId"]) is { Length: > 0 } catalogId) create["catalogId"] = V09BasicCatalogIds.Contains(catalogId) ? GenerativeUI.StandardCatalogId : catalogId;
        var send = payload["sendDataModel"] ?? payload["attachDataModel"];
        if (JsonText.IsBool(send)) create["sendDataModel"] = send!.GetValue<bool>();
        return new JsonObject { ["version"] = GenerativeUI.Version, ["createSurface"] = create };
    }

    /// <summary>Basic catalog components as standard ones; anything else stays.</summary>
    private static JsonNode? ToStandardComponents(JsonNode? components) =>
        components is JsonArray list
            ? new JsonArray(list.Select(node => node is JsonObject record ? BasicCatalogChanges((JsonObject)record.DeepClone()) : node?.DeepClone()).ToArray())
            : components?.DeepClone();

    /// <summary>
    /// A native A2UI 1.0 operation, for the standard catalog: the 1.0 basic catalog id becomes the standard catalog
    /// id, and the basic catalog components (inline in createSurface, or in updateComponents) get the changes of
    /// <see cref="BasicCatalogChanges"/>. Bindings are already 1.0. Everything else stays; the client validates the
    /// operation.
    /// </summary>
    private static JsonObject UpgradeV10Operation(JsonObject op)
    {
        var result = (JsonObject)op.DeepClone();
        if (result["createSurface"] is JsonObject create)
        {
            if (JsonText.Str(create["catalogId"]) is { } catalogId && V10BasicCatalogIds.Contains(catalogId)) create["catalogId"] = GenerativeUI.StandardCatalogId;
            if (create.ContainsKey("components")) create["components"] = ToStandardComponents(create["components"]);
        }
        else if (result["updateComponents"] is JsonObject update && update.ContainsKey("components"))
        {
            update["components"] = ToStandardComponents(update["components"]);
        }
        return result;
    }

    private static JsonObject UpgradeOperation(JsonNode? node)
    {
        if (node is not JsonObject op) throw new ConversionException("operation must be a JSON object");
        if (op.TryGetPropertyValue("version", out var version) && JsonText.Str(version) == GenerativeUI.Version) return UpgradeV10Operation(op);
        if (!IsV09Operation(op))
            throw new ConversionException(JsonText.Str(version) is { } text
                ? $"unsupported A2UI version \"{text}\"; only v0.9 and 1.0 operations are supported"
                : "not an A2UI v0.9 operation: it needs exactly one of " + string.Join(", ", V09Kinds));
        var kind = V09Kind(op) ?? throw new ConversionException("operation must contain exactly one of " + string.Join(", ", V09Kinds));
        if (op[kind] is not JsonObject payload || JsonText.Str(payload["surfaceId"]) is not { Length: > 0 } surfaceId) throw new ConversionException($"{kind}.surfaceId is required");
        switch (kind)
        {
            case "createSurface": return ConvertCreateSurface(payload, surfaceId);
            case "updateComponents":
                if (payload["components"] is not JsonArray { Count: > 0 } components) throw new ConversionException("updateComponents.components must be a non-empty array");
                return new JsonObject
                {
                    ["version"] = GenerativeUI.Version,
                    ["updateComponents"] = new JsonObject { ["surfaceId"] = surfaceId, ["components"] = new JsonArray(components.Select(component => (JsonNode?)ConvertComponent(component)).ToArray()) }
                };
            case "updateDataModel": return ConvertUpdateDataModel(payload, surfaceId);
            default: return new JsonObject { ["version"] = GenerativeUI.Version, ["deleteSurface"] = new JsonObject { ["surfaceId"] = surfaceId } };
        }
    }

    /// <summary>
    /// Convert A2UI v0.9 operations to 1.0, in order. Never throws. A native 1.0 operation keeps its form: only the
    /// 1.0 basic catalog id becomes the standard catalog id, and its basic catalog components get the same changes as
    /// v0.9 ones. Any other operation, and a v0.9 operation that cannot be converted, is returned in the second list
    /// with the reason.
    /// </summary>
    internal static (List<JsonObject> Upgraded, List<(JsonNode? Operation, string Reason)> Dropped) UpgradeOperations(JsonNode? operations)
    {
        var upgraded = new List<JsonObject>();
        var dropped = new List<(JsonNode?, string)>();
        foreach (var operation in operations as JsonArray ?? [])
        {
            try { upgraded.Add(UpgradeOperation(operation)); }
            catch (ConversionException error) { dropped.Add((operation, error.Message)); }
            catch (Exception error) { dropped.Add((operation, "operation could not be read: " + error.Message)); }
        }
        return (upgraded, dropped);
    }

    /// <summary>The nested <c>surfaceId</c> of a v0.9 or 1.0 surface operation.</summary>
    internal static string? SurfaceIdOf(JsonNode? op)
    {
        if (op is not JsonObject record) return null;
        foreach (var kind in V09Kinds)
            if (record[kind] is JsonObject payload && JsonText.Str(payload["surfaceId"]) is { } id) return id.Length > 0 ? id : null;
        return null;
    }

    internal static JsonArray ReadOperations(JsonNode? content) =>
        content is JsonObject record && (record[OperationsKey] ?? record["operations"]) is JsonArray operations ? operations : [];

    // -----------------------------------------------------------------------
    // RFC 6902 JSON Patch

    private static readonly HashSet<string> ForbiddenSegments = new(StringComparer.Ordinal) { "__proto__", "constructor", "prototype" };

    private static List<string> Segments(string pointer)
    {
        if (pointer.Length == 0) return [];
        if (!pointer.StartsWith('/')) throw new FormatException($"invalid pointer \"{pointer}\"");
        return pointer[1..].Split('/').Select(part => part.Replace("~1", "/").Replace("~0", "~")).ToList();
    }

    /// <summary>The index of an array segment; long.MaxValue for digits too large for an index.</summary>
    private static long? Index(string key)
    {
        if (key.Length == 0 || !key.All(char.IsAsciiDigit)) return null;
        return long.TryParse(key, NumberStyles.None, CultureInfo.InvariantCulture, out var index) ? index : long.MaxValue;
    }

    private static bool TryChild(JsonNode? parent, string key, out JsonNode? child)
    {
        child = null;
        if (parent is JsonArray array)
        {
            if (Index(key) is not { } index || index >= array.Count) return false;
            child = array[(int)index];
            return true;
        }
        return parent is JsonObject record && record.TryGetPropertyValue(key, out child);
    }

    /// <summary>
    /// Apply RFC 6902 operations to <paramref name="document"/> in place and return the new root.
    /// Throws on a path that does not resolve, so a bad delta leaves stored content alone.
    /// </summary>
    internal static JsonNode? ApplyJsonPatch(JsonNode? document, JsonNode? patch)
    {
        if (patch is not JsonArray operations) throw new FormatException("patch must be an array");
        var root = document;

        (JsonNode? Parent, string? Key) ParentOf(string pointer)
        {
            var segments = Segments(pointer);
            string? key = null;
            if (segments.Count > 0) { key = segments[^1]; segments.RemoveAt(segments.Count - 1); }
            var parent = root;
            foreach (var segment in segments)
            {
                if (ForbiddenSegments.Contains(segment)) throw new FormatException("forbidden path");
                if (!TryChild(parent, segment, out parent)) throw new FormatException($"path \"{pointer}\" not found");
            }
            if (key is not null && ForbiddenSegments.Contains(key)) throw new FormatException("forbidden path");
            return (parent, key);
        }

        bool Read(string pointer, out JsonNode? value)
        {
            var (parent, key) = ParentOf(pointer);
            if (key is null) { value = root; return true; }
            return TryChild(parent, key, out value);
        }

        void Remove(string pointer)
        {
            var (parent, key) = ParentOf(pointer);
            if (key is null) throw new FormatException("cannot remove the root");
            if (parent is JsonArray array)
            {
                var index = Index(key) ?? throw new FormatException($"path \"{pointer}\" not found");
                if (index < array.Count) array.RemoveAt((int)index);
            }
            else if (parent is JsonObject record && record.ContainsKey(key)) record.Remove(key);
            else throw new FormatException($"path \"{pointer}\" not found");
        }

        void Write(string pointer, JsonNode? value, bool insert)
        {
            var (parent, key) = ParentOf(pointer);
            if (key is null) root = value;
            else if (parent is JsonArray array)
            {
                var index = key == "-" ? array.Count : Index(key);
                if (index is null || index > array.Count) throw new FormatException($"index \"{key}\" is out of range");
                if (insert) array.Insert((int)index, value);
                else if (index < array.Count) array[(int)index] = value;
                else array.Add(value);
            }
            else if (parent is JsonObject record) record[key] = value;
            else throw new FormatException($"path \"{pointer}\" not found");
        }

        foreach (var entry in operations)
        {
            if (entry is not JsonObject operation || JsonText.Str(operation["path"]) is not { } path) throw new FormatException("invalid patch operation");
            var source = JsonText.Truthy(operation["from"]) ? JsonText.Str(operation["from"]) ?? throw new FormatException("invalid patch operation") : "";
            switch (JsonText.Str(operation["op"]))
            {
                case "add": Write(path, operation["value"]?.DeepClone(), true); break;
                case "replace":
                    if (!Read(path, out _)) throw new FormatException($"path \"{path}\" not found");
                    Write(path, operation["value"]?.DeepClone(), false);
                    break;
                case "remove": Remove(path); break;
                case "copy":
                    if (!Read(source, out var copied)) throw new FormatException($"path \"{source}\" has no value");
                    Write(path, copied?.DeepClone(), true);
                    break;
                case "move":
                    if (!Read(source, out var moved)) throw new FormatException($"path \"{source}\" has no value");
                    moved = moved?.DeepClone();
                    Remove(source);
                    Write(path, moved, true);
                    break;
                case "test":
                    if (!Read(path, out var actual) || JsonText.Compact(actual) != JsonText.Compact(operation["value"])) throw new FormatException($"test failed at \"{path}\"");
                    break;
                default: throw new FormatException($"unknown patch op \"{JsonText.Str(operation["op"])}\"");
            }
        }
        return root;
    }

    // -----------------------------------------------------------------------
    // Clicks (`a2ui-v09-actions.ts`)

    /// <summary>The 1.0 action of the user event that started the run, as a v0.9 user action.</summary>
    private static JsonObject? ReadAction(JsonObject? envelope)
    {
        if (envelope is null || GenerativeUI.Extensions(envelope)["copilotkit_action"] is not JsonObject message || message["action"] is not JsonObject action) return null;
        if (JsonText.Str(action["name"]) is not { } name || JsonText.Str(action["surfaceId"]) is not { } surfaceId) return null;
        return new JsonObject
        {
            ["name"] = name,
            ["surfaceId"] = surfaceId,
            ["sourceComponentId"] = JsonText.Str(action["sourceComponentId"]) ?? "",
            ["context"] = action["context"] is JsonObject context ? context.DeepClone() : new JsonObject(),
            ["timestamp"] = JsonText.Str(action["timestamp"]) ?? DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture)
        };
    }

    /// <summary>
    /// True when the surface was converted from v0.9. The client's surface summary decides (no
    /// <c>a2uiSourceVersion</c> means a 1.0 surface), then the last <c>generative-ui-surface</c> activity message of
    /// the surface, then the agent's version.
    /// </summary>
    private static bool IsV09Surface(JsonObject envelope, JsonArray messages, string surfaceId, string agentVersion)
    {
        var summary = GenerativeUI.Extensions(envelope)["copilotkit_surfaces"]?[surfaceId];
        if (summary is JsonObject entry) return JsonText.Str(entry["a2uiSourceVersion"]) == "0.9";
        for (var index = messages.Count - 1; index >= 0; index--)
        {
            if (messages[index] is JsonObject message && JsonText.Str(message["role"]) == "activity" && JsonText.Str(message["activityType"]) == GenerativeUI.ActivityType
                && message["content"] is JsonObject content && JsonText.Str(content["surfaceId"]) == surfaceId)
                return JsonText.Str(content["a2uiSourceVersion"]) == "0.9";
        }
        return agentVersion == "0.9";
    }

    /// <summary>
    /// Turn a click on a surface of v0.9 origin into the v0.9 action of the agent side. The 1.0 client sends a
    /// click as a visible user message plus <c>copilotkit_action</c> in the envelope. For a surface of v0.9 origin
    /// this returns a new input with <c>forwardedProps.a2uiAction.userAction</c> set and that user message removed,
    /// as the v0.9 client sent no message for a click. Otherwise it returns <paramref name="input"/>.
    /// </summary>
    internal static JsonObject DowngradeAction(JsonObject input, string agentVersion = "1.0")
    {
        // A run that already has a v0.9 action keeps it.
        if (input["forwardedProps"] is not JsonObject forwarded || forwarded.ContainsKey("a2uiAction")) return input;
        var envelope = GenerativeUI.ReadEnvelope(forwarded);
        var action = ReadAction(envelope);
        if (envelope is null || action is null) return input;
        var messages = input["messages"] as JsonArray ?? [];
        if (!IsV09Surface(envelope, messages, JsonText.Str(action["surfaceId"])!, agentVersion)) return input;
        var kept = messages.Select(message => message?.DeepClone()).ToList();
        // The client adds the visible click message just before the run.
        if (kept.Count > 0 && kept[^1] is JsonObject last && JsonText.Str(last["role"]) == "user" && JsonText.IsString(last["content"])) kept.RemoveAt(kept.Count - 1);
        var result = (JsonObject)input.DeepClone();
        result["messages"] = new JsonArray(kept.ToArray());
        result["forwardedProps"]!["a2uiAction"] = new JsonObject { ["userAction"] = action };
        return result;
    }

    // -----------------------------------------------------------------------
    // Catalog (`a2ui-v09-catalog.ts`)

    private const string V09BasicCatalogId = "https://a2ui.org/specification/v0_9/basic_catalog.json";
    private const string CapabilitiesDescription = "A2UI catalog capabilities: available catalog IDs and custom component definitions the client can render.";
    private const string GenerationGuidelinesDescription = "A2UI generation guidelines — protocol rules, tool arguments, path rules, data model format, and form/two-way-binding instructions.";
    private const string DesignGuidelinesDescription = "A2UI design guidelines — visual design rules, component hierarchy tips, and action handler patterns.";
    // The components of the v0.9 basic catalog. The 1.0 standard catalog has each of them.
    private static readonly string[] V09BasicComponents =
    [
        "Text", "Image", "Icon", "Video", "AudioPlayer", "Row", "Column", "List", "Card", "Tabs", "Modal",
        "Divider", "Button", "TextField", "CheckBox", "ChoicePicker", "Slider", "DateTimeInput",
    ];
    // The components of the 1.0 standard catalog (`standardDeclarations`).
    private static readonly HashSet<string> StandardComponents = new((
        "Box Column Row Grid GridItem Card Flow FlowItem Carousel CarouselItem CarouselMediaItem "
        + "Spacer Divider Tabs Title Text Caption Label Bold Italic Underline Strikethrough Badge "
        + "Blockquote Code Markdown Math ShimmerText Link Tooltip Button Pressable Form TextField "
        + "TextArea Select CheckBox Radio RadioGroup Slider SegmentedControl ChoicePicker "
        + "DateTimeInput PulseIndicator FlashcardFlip Popover PopoverTrigger PopoverContent Modal "
        + "Table TableSection TableRow TableCell List ListItem Chart Map Image Icon Favicon Svg "
        + "Video AudioPlayer HtmlView LinkCard Citation FollowUp EntityCard ImageGrid").Split(' '), StringComparer.Ordinal);
    // Props of standard components that v0.9 names differently: component → 1.0 → v0.9 name.
    private static readonly Dictionary<string, Dictionary<string, string>> V10ToV09PropNames = new(StringComparer.Ordinal) { ["Button"] = new(StringComparer.Ordinal) { ["onClick"] = "action" } };
    private static readonly Dictionary<string, string> NoRenames = new(StringComparer.Ordinal);
    private const string Common = "common_types.json#/$defs/";

    private static JsonObject Ref(string name) => new() { ["$ref"] = Common + name };

    // The v0.9 common types that the schemas reference, so every ref resolves in the payload.
    private const string V09CommonTypes = """
        {
          "ComponentId": {
            "type": "string",
            "description": "The unique identifier for a component, used for both definitions and references within the same surface."
          },
          "ComponentCommon": {
            "type": "object",
            "properties": {
              "id": {
                "$ref": "common_types.json#/$defs/ComponentId"
              },
              "accessibility": {
                "$ref": "common_types.json#/$defs/AccessibilityAttributes"
              }
            },
            "required": [
              "id"
            ]
          },
          "AccessibilityAttributes": {
            "type": "object",
            "description": "Attributes to enhance accessibility when using assistive technologies like screen readers.",
            "properties": {
              "label": {
                "$ref": "common_types.json#/$defs/DynamicString"
              },
              "description": {
                "$ref": "common_types.json#/$defs/DynamicString"
              }
            }
          },
          "ChildList": {
            "oneOf": [
              {
                "type": "array",
                "items": {
                  "$ref": "common_types.json#/$defs/ComponentId"
                },
                "description": "A static list of child component IDs."
              },
              {
                "type": "object",
                "description": "A template for generating a dynamic list of children from a data model list. The `componentId` is the component to use as a template.",
                "properties": {
                  "componentId": {
                    "$ref": "common_types.json#/$defs/ComponentId"
                  },
                  "path": {
                    "type": "string",
                    "description": "The path to the list of component property objects in the data model."
                  }
                },
                "required": [
                  "componentId",
                  "path"
                ],
                "additionalProperties": false
              }
            ]
          },
          "DataBinding": {
            "type": "object",
            "properties": {
              "path": {
                "type": "string",
                "description": "A JSON Pointer path to a value in the data model."
              }
            },
            "required": [
              "path"
            ],
            "additionalProperties": false
          },
          "FunctionCall": {
            "type": "object",
            "description": "Invokes a named function on the client.",
            "properties": {
              "call": {
                "type": "string",
                "description": "The name of the function to call."
              },
              "args": {
                "type": "object",
                "description": "Arguments passed to the function.",
                "additionalProperties": {
                  "$ref": "common_types.json#/$defs/DynamicValue"
                }
              }
            },
            "required": [
              "call"
            ],
            "additionalProperties": false
          },
          "DynamicValue": {
            "description": "A value that can be a literal, a path, or a function call returning any type.",
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "number"
              },
              {
                "type": "boolean"
              },
              {
                "type": "array"
              },
              {
                "$ref": "common_types.json#/$defs/DataBinding"
              },
              {
                "$ref": "common_types.json#/$defs/FunctionCall"
              }
            ]
          },
          "DynamicString": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "$ref": "common_types.json#/$defs/DataBinding"
              },
              {
                "$ref": "common_types.json#/$defs/FunctionCall"
              }
            ]
          },
          "DynamicNumber": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "$ref": "common_types.json#/$defs/DataBinding"
              },
              {
                "$ref": "common_types.json#/$defs/FunctionCall"
              }
            ]
          },
          "DynamicBoolean": {
            "anyOf": [
              {
                "type": "boolean"
              },
              {
                "$ref": "common_types.json#/$defs/DataBinding"
              },
              {
                "$ref": "common_types.json#/$defs/FunctionCall"
              }
            ]
          },
          "DynamicStringList": {
            "anyOf": [
              {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              {
                "$ref": "common_types.json#/$defs/DataBinding"
              },
              {
                "$ref": "common_types.json#/$defs/FunctionCall"
              }
            ]
          },
          "Action": {
            "description": "Defines an interaction handler that can either trigger a server-side event or execute a local client-side function.",
            "oneOf": [
              {
                "type": "object",
                "description": "Triggers a server-side event.",
                "properties": {
                  "event": {
                    "type": "object",
                    "properties": {
                      "name": {
                        "type": "string",
                        "description": "The name of the action to be dispatched to the server."
                      },
                      "context": {
                        "type": "object",
                        "description": "A JSON object containing the key-value pairs for the action context. Values can be literals or paths.",
                        "additionalProperties": {
                          "$ref": "common_types.json#/$defs/DynamicValue"
                        }
                      }
                    },
                    "required": [
                      "name"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "event"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "description": "Executes a local client-side function.",
                "properties": {
                  "functionCall": {
                    "$ref": "common_types.json#/$defs/FunctionCall"
                  }
                },
                "required": [
                  "functionCall"
                ],
                "additionalProperties": false
              }
            ]
          }
        }
        """;

    internal const string GenerationGuidelines = """
        Generate A2UI v0.9 JSON.

        ## A2UI Protocol Instructions

        A2UI (Agent to UI) is a protocol for rendering rich UI surfaces from agent responses.

        CRITICAL: You MUST call the render_a2ui tool with ALL of these arguments:
        - surfaceId: A unique ID for the surface (e.g. "product-comparison")
        - components: REQUIRED — the A2UI component array. NEVER omit this. Only use
          components listed in the Available Components schema provided as context.
        - data: OPTIONAL — a JSON object written to the root of the surface data model.
          Use for pre-filling form values or providing data for path-bound components.
        - every component must have the "component" field specifying the component type.
          ONLY use component names from the Available Components schema — do NOT invent
          component names or use names not in the schema.

        COMPONENT ID RULES:
        - Exactly one component MUST have id="root". This is the surface's entry
          point — the renderer begins at "root" and walks the child/children tree
          from there. Every other component must be reachable from "root". If no
          component has id="root", the surface renders an empty loading placeholder
          and none of your components will be shown.
        - Every component ID must be unique within the surface.
        - A component MUST NOT reference itself as child/children. This causes a
          circular dependency error. For example, if a component has id="avatar",
          its child must be a DIFFERENT id (e.g. "avatar-img"), never "avatar".
        - The child/children tree must be a DAG — no cycles allowed.

        REPEATING CONTENT (TEMPLATES):
        To repeat a component for each item in an array, use the structural children format:
          children: { componentId: "card-id", path: "/items" }
        This tells the renderer to create one instance of "card-id" per item in the "/items" array.

        PATH RULES FOR TEMPLATES:
        Components inside a repeating template use RELATIVE paths (no leading slash).
        The path is resolved relative to each array item automatically.
        If a container has children: { componentId: "card", path: "/items" } and each item
        has a key "name", use { "path": "name" } (NO leading slash — relative to item).
        CRITICAL: Do NOT use "/name" (absolute) inside templates — use "name" (relative).
        The container's path ("/items") uses a leading slash (absolute), but all
        components INSIDE the template use paths WITHOUT leading slash.

        COMPONENT VALUES — DEFAULT RULE:
        Use inline literal values for ALL component properties. Pass strings, numbers,
        arrays, and objects directly on the component. Do NOT use { "path": "..." }
        objects unless the property's schema explicitly allows it (see exception below).
        CRITICAL: USING { "path": "..." } ON A PROPERTY THAT DOES NOT DECLARE PATH
        SUPPORT IN ITS SCHEMA WILL CAUSE A RUNTIME CRASH AND BREAK THE ENTIRE UI.
        ALWAYS CHECK THE COMPONENT SCHEMA FIRST — IF THE PROPERTY ONLY ACCEPTS A
        PLAIN TYPE, YOU MUST USE A LITERAL VALUE.
        VERY IMPORTANT: THE APPLICATION WILL BREAK IF YOU DO NOT FOLLOW THIS RULE!

        For example, a chart's "data" must always be an inline array:
          "data": [{"label": "Jan", "value": 100}, {"label": "Feb", "value": 200}]
        A metric's "value" must always be an inline string:
          "value": "$1,200"

        PATH BINDING EXCEPTION — SCHEMA-DRIVEN:
        A few properties accept { "path": "/some/path" } as an alternative to a literal
        value. You can identify these in the Available Components schema: the property
        will list BOTH a literal type AND an object-with-path option. If a property only
        shows a single type (string, number, array, etc.), it does NOT support path
        binding — use a literal value only.

        Path binding is typically used for editable form inputs so the client can write
        user input back to the data model. When building forms:
        - Bind input "value" to a data model path: "value": { "path": "/form/name" }
        - Pre-fill via the "data" tool argument: "data": { "form": { "name": "Alice" } }
        - Capture values on submit via button action context:
            "action": { "event": { "name": "submit", "context": { "name": { "path": "/form/name" } } } }

        REPEATING CONTENT uses a structural children format (not the same as value binding):
          children: { componentId: "card-id", path: "/items" }
        Components inside templates use RELATIVE paths (no leading slash): { "path": "name" }.
        """;

    internal const string DesignGuidelines = """
        Create polished, visually appealing interfaces. ONLY use components listed in the
        Available Components schema — do NOT use component names that are not in the schema.

        Design principles:
        - Create clear visual hierarchy within cards and layouts.
        - Keep cards clean — avoid clutter. Whitespace is good.
        - Use consistent surfaceIds (lowercase, hyphenated).
        - NEVER use the same ID for a component and its child — this creates a
          circular dependency. E.g. if id="avatar", child must NOT be "avatar".
        - For side-by-side comparisons, use a container with structural children
          (children: { componentId, path }) to repeat a card template per data item.
        - Include images when relevant (logos, icons, product photos):
          - Prefer company logos via Google favicons: https://www.google.com/s2/favicons?domain=example.com&sz=128
          - Do NOT invent Unsplash photo-IDs — they will 404. Only use real, known URLs.
        - For buttons: action MUST use this exact nested format:
            "action": { "event": { "name": "myAction", "context": { "key": "value" } } }
          The "event" key holds an OBJECT with "name" (required) and "context" (optional).
          Do NOT use a flat format like {"event": "name"} — "event" must be an object.
        - For forms: check the component schema — if an input's "value" property
          supports path binding, use it for editable fields. The submit button's
          action context should reference the same paths to capture user input.

        Use the SAME surfaceId as the main surface. Match action names to button action event names.
        """;

    private static readonly Dictionary<string, string> DynamicTypes = new(StringComparer.Ordinal) { ["string"] = "DynamicString", ["number"] = "DynamicNumber", ["boolean"] = "DynamicBoolean" };
    private static readonly Dictionary<string, string> DynamicRefs = new(StringComparer.Ordinal)
    {
        ["string"] = "DynamicString", ["number"] = "DynamicNumber", ["boolean"] = "DynamicBoolean", ["string[]"] = "DynamicStringList", ["unknown"] = "DynamicValue",
    };

    /// <summary>1.0 binding and call syntax in a description, written the v0.9 way.</summary>
    private static string V09Text(string text) => text.Replace("\"@path\"", "\"path\"").Replace("\"@call\"", "\"call\"");

    /// <summary>A copy of a schema, with its descriptions written the v0.9 way.</summary>
    private static JsonNode? V09Schema(JsonNode? value)
    {
        if (value is JsonArray array) return new JsonArray(array.Select(V09Schema).ToArray());
        if (value is not JsonObject record) return value?.DeepClone();
        var result = new JsonObject();
        foreach (var (key, child) in record) result[key] = key == "description" && JsonText.Str(child) is { } text ? V09Text(text) : V09Schema(child);
        return result;
    }

    private static JsonObject With(JsonObject first, JsonObject second)
    {
        var result = (JsonObject)first.DeepClone();
        foreach (var (key, value) in second) result[key] = value?.DeepClone();
        return result;
    }

    /// <summary>A prop as v0.9 states it: its literal schema, a <c>{ path }</c> or a <c>{ call }</c>. Only the prop itself is made dynamic, as in the v0.9 basic catalog.</summary>
    private static JsonObject DynamicValue(JsonNode? schema)
    {
        if (schema is not JsonObject record) return Ref("DynamicValue");
        var v09 = (JsonObject)V09Schema(record)!;
        if (GenerativeUI.ChildRefKind(record) is not null) return v09;
        var literal = Without(v09, "description");
        var text = JsonText.Str(v09["description"]) is { } description ? new JsonObject { ["description"] = description } : [];
        if (literal.Count == 1 && JsonText.Str(literal["type"]) is { } type && DynamicTypes.TryGetValue(type, out var dynamic)) return With(Ref(dynamic), text);
        if (literal.Count == 2 && JsonText.Str(literal["type"]) == "array" && literal["items"] is JsonObject { Count: 1 } items && JsonText.Str(items["type"]) == "string")
            return With(Ref("DynamicStringList"), text);
        return With(text, new JsonObject { ["anyOf"] = new JsonArray(literal, Ref("DataBinding"), Ref("FunctionCall")) });
    }

    /// <summary>An object schema with each of its properties made dynamic.</summary>
    private static JsonObject DynamicProperties(JsonObject schema)
    {
        var result = (JsonObject)V09Schema(schema)!;
        if (schema["properties"] is JsonObject properties)
        {
            var dynamic = new JsonObject();
            foreach (var (key, value) in properties) dynamic[key] = DynamicValue(value);
            result["properties"] = dynamic;
        }
        return result;
    }

    /// <summary>Point the local refs (<c>#/...</c>) of a props schema to where it is embedded.</summary>
    private static JsonNode? RebaseRefs(JsonNode? value, string @base)
    {
        if (value is JsonArray array) return new JsonArray(array.Select(item => RebaseRefs(item, @base)).ToArray());
        if (value is not JsonObject record) return value?.DeepClone();
        var result = new JsonObject();
        foreach (var (key, child) in record) result[key] = RebaseRefs(child, @base);
        var target = JsonText.Str(result["$ref"]);
        if (target == "#") result["$ref"] = @base;
        else if (target is not null && target.StartsWith("#/", StringComparison.Ordinal)) result["$ref"] = @base + target[1..];
        return result;
    }

    /// <summary>One component in the v0.9 inline catalog format, under its v0.9 prop names.</summary>
    private static JsonObject ComponentSchema(string name, JsonObject manifest, IReadOnlyDictionary<string, string> renames)
    {
        var props = (JsonObject)manifest["props"]!;
        var fields = new JsonObject();
        foreach (var (key, schema) in props["properties"] as JsonObject ?? []) fields[key] = DynamicValue(schema);
        foreach (var (key, node) in JsonText.Truthy(manifest["events"]) ? manifest["events"] as JsonObject ?? [] : [])
        {
            var field = Ref("Action");
            if (JsonText.Str(node?["description"]) is { Length: > 0 } description) field["description"] = V09Text(description);
            fields[key] = field;
        }
        foreach (var (key, kind) in JsonText.Truthy(manifest["slots"]) ? manifest["slots"] as JsonObject ?? [] : [])
            fields[key] = Ref(JsonText.Str(kind) == "single" ? "ComponentId" : "ChildList");
        var ordered = new JsonObject { ["component"] = new JsonObject { ["const"] = name } };
        var order = (manifest["parameterOrder"] as JsonArray ?? []).Select(JsonText.Str).OfType<string>().Concat(fields.Select(pair => pair.Key)).ToList();
        foreach (var key in order)
            if (fields.ContainsKey(key)) ordered[renames.GetValueOrDefault(key, key)] = fields[key]!.DeepClone();
        var required = new JsonArray("component");
        foreach (var key in props["required"] as JsonArray ?? []) if (JsonText.Str(key) is { } field) required.Add(renames.GetValueOrDefault(field, field));
        var body = new JsonObject { ["properties"] = ordered, ["required"] = required };
        foreach (var key in new[] { "$defs", "definitions" })
            if (props[key] is JsonObject definitions) body[key] = V09Schema(definitions);
        var segment = name.Replace("~", "~0").Replace("/", "~1");
        var text = manifest["description"] is { } own ? JsonText.Str(own) : JsonText.Str(props["description"]);
        var result = new JsonObject();
        if (text is not null) result["description"] = V09Text(text);
        result["allOf"] = new JsonArray(Ref("ComponentCommon"), RebaseRefs(body, $"#/components/{segment}/allOf/1"));
        return result;
    }

    private static JsonObject TypeSchema(string type)
    {
        var trimmed = type.Trim();
        var alternatives = trimmed.Split('|').Select(part => part.Trim()).ToList();
        if (alternatives.Count > 1) return new JsonObject { ["anyOf"] = new JsonArray(alternatives.Select(part => (JsonNode?)TypeSchema(part)).ToArray()) };
        if (DynamicRefs.TryGetValue(trimmed, out var dynamic)) return Ref(dynamic);
        // The whole list can be bound or computed, like any other arg.
        if (trimmed.EndsWith("[]", StringComparison.Ordinal))
            return new JsonObject { ["anyOf"] = new JsonArray(new JsonObject { ["type"] = "array", ["items"] = TypeSchema(trimmed[..^2]) }, Ref("DataBinding"), Ref("FunctionCall")) };
        return Ref("DynamicValue");
    }

    /// <summary>The JSON Schema of the args of a built-in function, from its short signature.</summary>
    internal static JsonObject ArgsSchemaFromSignature(string signature)
    {
        var body = signature.Trim();
        if (body.StartsWith('{')) body = body[1..];
        if (body.EndsWith('}')) body = body[..^1];
        var properties = new JsonObject();
        var required = new JsonArray();
        JsonNode additional = false;
        foreach (var part in body.Split(';'))
        {
            var entry = part.Trim();
            if (entry.Length == 0) continue;
            var index = Regex.Match(entry, @"^\[[A-Za-z0-9_]+: string\]:\s*(.+)$");
            if (index.Success) { additional = TypeSchema(index.Groups[1].Value); continue; }
            var named = Regex.Match(entry, @"^([A-Za-z0-9_]+)(\?)?:\s*(.+)$");
            if (!named.Success) continue;
            properties[named.Groups[1].Value] = TypeSchema(named.Groups[3].Value);
            if (!named.Groups[2].Success) required.Add(named.Groups[1].Value);
        }
        var result = new JsonObject { ["type"] = "object", ["properties"] = properties };
        if (required.Count > 0) result["required"] = required;
        result["additionalProperties"] = additional;
        return result;
    }

    private static JsonObject FunctionSchema(string name, string? description, JsonNode? returnType, JsonObject parameters)
    {
        var result = new JsonObject { ["name"] = name };
        if (!string.IsNullOrEmpty(description)) result["description"] = V09Text(description);
        // v0.9 has no `validationResult`: its checks are boolean function calls.
        result["returnType"] = JsonText.Str(returnType) == "validationResult" ? "boolean" : returnType?.DeepClone() ?? JsonValue.Create("any");
        result["parameters"] = parameters;
        return result;
    }

    /// <summary>The basic functions, then the app functions the renderer may call.</summary>
    private static JsonArray CatalogFunctions(JsonObject functions)
    {
        var result = new JsonArray();
        foreach (var (name, info) in GenerativeUI.A2UIBasicFunctions)
            if (!functions.ContainsKey(name)) result.Add(FunctionSchema(name, info.Description, info.ReturnType, ArgsSchemaFromSignature(info.Parameters)));
        foreach (var (name, node) in functions)
            if (node is JsonObject function && GenerativeUI.FunctionCallers(function).Renderer)
                result.Add(FunctionSchema(name, JsonText.Str(function["description"]), function["returnType"], DynamicProperties((JsonObject)function["parameters"]!)));
        return result;
    }

    /// <summary>The catalog id, then the components beyond the v0.9 basic catalog, by name.</summary>
    private static string Capabilities(string catalogId, IReadOnlyList<string>? names)
    {
        var lines = new List<string> { "Available A2UI catalog:" };
        if (names is null) { lines.Add("- " + catalogId); return string.Join("\n", lines); }
        var extra = names.Where(name => !V09BasicComponents.Contains(name)).ToList();
        var isSuperset = V09BasicComponents.All(names.Contains);
        if (catalogId == V09BasicCatalogId && isSuperset && extra.Count == 0) { lines.Add($"- {catalogId} (basic catalog)"); return string.Join("\n", lines); }
        lines.Add("- " + catalogId);
        if (isSuperset) lines.Add("  Extends the basic catalog with all standard components plus:");
        else { lines.Add("  Custom catalog (does NOT include all basic components)."); lines.Add("  Custom components:"); }
        lines.AddRange(extra.Select(name => "  - " + name));
        return string.Join("\n", lines);
    }

    private static JsonObject Entry(string description, string value) => new() { ["description"] = description, ["value"] = value };

    /// <summary>
    /// The A2UI v0.9 catalog context of a run, from the client's generative UI envelope: capabilities, the
    /// component schema in the v0.9 inline catalog format, and the v0.9 generation and design guidelines.
    /// The components are the 18 basic ones of the standard catalog plus the UI's own components. The catalog
    /// id is the v0.9 basic catalog id when the UI includes the standard catalog. Null when the run has no envelope.
    /// </summary>
    internal static (string CatalogId, List<JsonObject> Entries)? BuildCatalogContext(JsonObject input)
    {
        if (GenerativeUI.ReadEnvelope(input["forwardedProps"]) is not { } envelope) return null;
        var manifest = GenerativeUI.ToManifest(envelope);
        var extendsStandard = (manifest.CatalogIds.Count > 0 ? manifest.CatalogIds : [manifest.CatalogId]).Contains(GenerativeUI.StandardCatalogId);
        var catalogId = extendsStandard ? V09BasicCatalogId : manifest.CatalogId;
        if (!manifest.HasComponents) return (catalogId, [Entry(CapabilitiesDescription, Capabilities(catalogId, null))]);
        var components = new JsonObject();
        foreach (var (name, node) in manifest.Components)
        {
            var isStandard = extendsStandard && StandardComponents.Contains(name);
            // Of the standard components, a v0.9 agent knows the basic ones only.
            if (isStandard && !V09BasicComponents.Contains(name)) continue;
            IReadOnlyDictionary<string, string> renames = isStandard && V10ToV09PropNames.TryGetValue(name, out var map) ? map : NoRenames;
            components[name] = ComponentSchema(name, (JsonObject)node!, renames);
        }
        var schema = new JsonObject
        {
            ["catalogId"] = catalogId,
            ["components"] = components,
            ["functions"] = CatalogFunctions(manifest.Functions),
            ["common_types.json"] = new JsonObject { ["$defs"] = JsonText.Parse(V09CommonTypes) }
        };
        return (catalogId,
        [
            Entry(CapabilitiesDescription, Capabilities(catalogId, components.Select(pair => pair.Key).ToList())),
            Entry(A2UIAgent.SchemaContextDescription, JsonText.Compact(schema)),
            Entry(GenerationGuidelinesDescription, GenerationGuidelines),
            Entry(DesignGuidelinesDescription, DesignGuidelines),
        ]);
    }

    // -----------------------------------------------------------------------
    // The bridge (`a2ui-v09-middleware.ts`)

    /// <summary>
    /// The input of the agent side of a run; never mutates <paramref name="input"/>. A click on a surface of
    /// v0.9 origin becomes the v0.9 action. A 0.9 agent also gets the v0.9 catalog context; an entry with the
    /// same description is replaced. The runtime stores the client's input, so the thread keeps the click message.
    /// </summary>
    internal static JsonObject PrepareAgentInput(JsonObject input, string agentVersion)
    {
        var agentInput = DowngradeAction(input, agentVersion);
        if (agentVersion != "0.9" || BuildCatalogContext(agentInput) is not { } catalog) return agentInput;
        var descriptions = catalog.Entries.Select(entry => JsonText.Str(entry["description"])).ToHashSet(StringComparer.Ordinal);
        var context = (agentInput["context"] as JsonArray ?? [])
            .Where(entry => !(entry is JsonObject record && descriptions.Contains(JsonText.Str(record["description"]))))
            .Select(entry => entry?.DeepClone()).Concat(catalog.Entries).ToArray();
        var result = ReferenceEquals(agentInput, input) ? (JsonObject)input.DeepClone() : agentInput;
        result["context"] = new JsonArray(context);
        return result;
    }
}

/// <summary>
/// Converts the <c>a2ui-surface</c> surfaces of one run (A2UI v0.9, or native 1.0) to <c>generative-ui-surface</c>
/// surfaces. Create one per run. An <c>a2ui-surface</c> snapshot or delta is kept per messageId and its operations
/// converted. Each surface becomes one <c>genui:&lt;surfaceId&gt;</c> message: a surface created in this run is sent
/// as a cumulative snapshot (chat target, status "ready", <c>a2uiSourceVersion</c> "0.9" for a surface written in
/// v0.9); a surface that this run only updates gets its new operations as an <c>ACTIVITY_DELTA</c>. A surface written
/// in native 1.0 (for example by ADK) has no <c>a2uiSourceVersion</c>, so a click on it reaches the agent unchanged.
/// One surface has one version, the version of its first operation; an operation of the other version is rejected.
/// A lifecycle snapshot (no operations) names no surface, so it is consumed. A <c>failed</c> one (the agent's recovery
/// gave up) becomes a surface with no operations, status "error", and its error as the one rejected entry, so the chat
/// shows that the UI could not be made. Its surfaceId is the source messageId.
/// </summary>
internal sealed class A2UIV09ActivityUpgrader
{
    private sealed class SourcePart
    {
        // Each converted operation, with its index in the source message and its version ("0.9" or "1.0").
        internal List<(JsonObject Operation, int Index, string Version)> Operations { get; } = [];
        internal JsonArray Rejected { get; } = [];
    }

    private sealed class SurfaceState
    {
        // The part of each source message, in the order they first touched the surface.
        internal List<KeyValuePair<string, SourcePart>> Parts { get; } = [];
        internal string? LastSnapshot { get; set; }
        // Operations sent as deltas, for a surface created in an earlier run.
        internal List<string> SentOperations { get; set; } = [];
        internal string SentRejected { get; set; } = "[]";
    }

    private readonly Dictionary<string, JsonNode?> sources = new(StringComparer.Ordinal);
    private readonly Dictionary<string, SurfaceState> surfaces = new(StringComparer.Ordinal);
    private readonly List<string> surfaceOrder = [];
    // The source messages whose `failed` snapshot was sent.
    private readonly HashSet<string> failures = new(StringComparer.Ordinal);

    /// <summary>The error of a <c>failed</c> lifecycle snapshot (the agent's A2UI recovery gave up), or null.</summary>
    private static string? FailedLifecycleError(JsonNode? content)
    {
        if (content is not JsonObject record || JsonText.Str(record["status"]) != "failed") return null;
        var error = JsonText.Str(record["error"]) is { Length: > 0 } message ? message : "A2UI generation failed";
        return error.Length > GenerativeUI.MaxRejectionLength ? error[..GenerativeUI.MaxRejectionLength] : error;
    }

    /// <summary>The surface that shows a failed lifecycle snapshot, sent once.</summary>
    private List<JsonObject> Failure(string surfaceId, string error)
    {
        if (!failures.Add(surfaceId)) return [];
        var content = new JsonObject
        {
            ["surfaceId"] = surfaceId,
            ["target"] = GenerativeUI.ChatTarget,
            ["catalogId"] = GenerativeUI.StandardCatalogId,
            ["operations"] = new JsonArray(),
            ["status"] = "error",
            ["rejected"] = new JsonArray(new JsonObject { ["index"] = 0, ["reason"] = error }),
            ["a2uiSourceVersion"] = "0.9",
        };
        return [new JsonObject { ["type"] = "ACTIVITY_SNAPSHOT", ["messageId"] = GenerativeUI.SurfaceMessageId(surfaceId), ["activityType"] = GenerativeUI.ActivityType, ["content"] = content, ["replace"] = true }];
    }

    private static List<JsonObject> Snapshot(string surfaceId, SurfaceState state, List<JsonObject> operations, JsonArray rejected, string version)
    {
        var create = operations.FirstOrDefault(op => op.ContainsKey("createSurface"));
        var catalogId = create?["createSurface"] is JsonObject payload && JsonText.Truthy(payload["catalogId"]) ? payload["catalogId"]!.DeepClone() : JsonValue.Create(GenerativeUI.StandardCatalogId);
        var content = new JsonObject
        {
            ["surfaceId"] = surfaceId,
            ["target"] = GenerativeUI.ChatTarget,
            ["catalogId"] = catalogId,
            ["operations"] = new JsonArray(operations.Select(op => (JsonNode?)op.DeepClone()).ToArray()),
            ["status"] = "ready",
            ["rejected"] = rejected.DeepClone(),
        };
        if (version == "0.9") content["a2uiSourceVersion"] = "0.9";
        var serialized = JsonText.Compact(content);
        if (serialized == state.LastSnapshot) return [];
        state.LastSnapshot = serialized;
        return [new JsonObject { ["type"] = "ACTIVITY_SNAPSHOT", ["messageId"] = GenerativeUI.SurfaceMessageId(surfaceId), ["activityType"] = GenerativeUI.ActivityType, ["content"] = content, ["replace"] = true }];
    }

    private static List<JsonObject> Delta(string surfaceId, SurfaceState state, List<JsonObject> operations, JsonArray rejected)
    {
        var current = operations.Select(op => JsonText.Compact(op)).ToList();
        var same = 0;
        while (same < state.SentOperations.Count && same < current.Count && state.SentOperations[same] == current[same]) same++;
        // Operations that changed after they were sent cannot be taken back. v0.9 updates replace by id or path, so sending them again is safe.
        var patch = new JsonArray(operations.Skip(same).Select(op => (JsonNode?)new JsonObject { ["op"] = "add", ["path"] = "/operations/-", ["value"] = op.DeepClone() }).ToArray());
        var serialized = JsonText.Compact(rejected);
        if (serialized != state.SentRejected) patch.Add(new JsonObject { ["op"] = "replace", ["path"] = "/rejected", ["value"] = rejected.DeepClone() });
        state.SentOperations = current;
        state.SentRejected = serialized;
        if (patch.Count == 0) return [];
        return [new JsonObject { ["type"] = "ACTIVITY_DELTA", ["messageId"] = GenerativeUI.SurfaceMessageId(surfaceId), ["activityType"] = GenerativeUI.ActivityType, ["patch"] = patch }];
    }

    private List<JsonObject> Emit(string surfaceId)
    {
        if (!surfaces.TryGetValue(surfaceId, out var state)) return [];
        var operations = new List<JsonObject>();
        var rejected = new JsonArray();
        var created = false;
        string? version = null;
        foreach (var (_, part) in state.Parts)
        {
            foreach (var (op, index, opVersion) in part.Operations)
            {
                version ??= opVersion;
                if (opVersion != version)
                {
                    rejected.Add(new JsonObject { ["index"] = index, ["reason"] = $"surface \"{surfaceId}\" is A2UI {version}; an A2UI {opVersion} operation cannot change it" });
                    continue;
                }
                if (op.ContainsKey("createSurface"))
                {
                    // A second createSurface of the same id is rejected in 1.0.
                    if (created) continue;
                    created = true;
                }
                operations.Add(op);
            }
            foreach (var entry in part.Rejected) rejected.Add(entry?.DeepClone());
        }
        return created ? Snapshot(surfaceId, state, operations, rejected, version ?? "0.9") : Delta(surfaceId, state, operations, rejected);
    }

    /// <summary>Convert the stored content of one source message again.</summary>
    private List<JsonObject> Refresh(string messageId, string? sourceId)
    {
        var parts = new List<KeyValuePair<string, SourcePart>>();
        var operations = A2UIUpgrade.ReadOperations(sources.GetValueOrDefault(messageId));
        for (var index = 0; index < operations.Count; index++)
        {
            var op = operations[index];
            // An operation with no surface cannot be shown anywhere.
            if (A2UIUpgrade.SurfaceIdOf(op) is not { } surfaceId) continue;
            var part = parts.FirstOrDefault(pair => pair.Key == surfaceId).Value;
            if (part is null) { part = new SourcePart(); parts.Add(new(surfaceId, part)); }
            var (upgraded, dropped) = A2UIUpgrade.UpgradeOperations(new JsonArray(op?.DeepClone()));
            // Only v0.9 and 1.0 operations convert.
            var version = op is JsonObject record && JsonText.Str(record["version"]) == GenerativeUI.Version ? "1.0" : "0.9";
            foreach (var operation in upgraded) part.Operations.Add((operation, index, version));
            foreach (var (_, reason) in dropped) part.Rejected.Add(new JsonObject { ["index"] = index, ["reason"] = reason });
        }
        var touched = parts.Select(pair => pair.Key).ToList();
        foreach (var surfaceId in surfaceOrder)
        {
            if (parts.Any(pair => pair.Key == surfaceId)) continue;
            var removed = surfaces[surfaceId].Parts.RemoveAll(pair => pair.Key == messageId);
            if (removed > 0 && !touched.Contains(surfaceId)) touched.Add(surfaceId);
        }
        foreach (var (surfaceId, part) in parts)
        {
            if (!surfaces.TryGetValue(surfaceId, out var state)) { state = new SurfaceState(); surfaces[surfaceId] = state; surfaceOrder.Add(surfaceId); }
            var index = state.Parts.FindIndex(pair => pair.Key == messageId);
            if (index >= 0) state.Parts[index] = new(messageId, part); else state.Parts.Add(new(messageId, part));
        }
        var events = touched.SelectMany(Emit).ToList();
        if (sourceId is not null && FailedLifecycleError(sources.GetValueOrDefault(messageId)) is { } error) events.AddRange(Failure(sourceId, error));
        return events;
    }

    /// <summary>The events that replace one event of the run.</summary>
    internal List<JsonObject> Transform(JsonObject value)
    {
        var type = JsonText.Str(value["type"]);
        if (type is not ("ACTIVITY_SNAPSHOT" or "ACTIVITY_DELTA") || JsonText.Str(value["activityType"]) != A2UIUpgrade.V09SurfaceActivityType) return [value];
        var messageId = JsonText.Compact(value["messageId"]);
        var sourceId = JsonText.Str(value["messageId"]);
        if (type == "ACTIVITY_SNAPSHOT")
        {
            // `replace: false` does not replace a message that already exists.
            if (JsonText.IsFalse(value["replace"]) && sources.ContainsKey(messageId)) return [];
            sources[messageId] = value["content"]?.DeepClone();
            return Refresh(messageId, sourceId);
        }
        if (!sources.TryGetValue(messageId, out var stored)) return [];
        try { sources[messageId] = A2UIUpgrade.ApplyJsonPatch(stored?.DeepClone(), value["patch"]); }
        // The AG-UI client also skips a delta that does not apply.
        catch (Exception error) when (error is FormatException or InvalidOperationException or ArgumentException) { return []; }
        return Refresh(messageId, sourceId);
    }
}

/// <summary>Runs an agent through the v0.9 bridge: the agent side gets the v0.9 input, the browser gets 1.0 surfaces.</summary>
internal sealed class A2UIV09BridgeAgent(IRuntimeAgent next, string agentVersion) : IRuntimeAgent
{
    public string Description => next.Description;

    public async IAsyncEnumerable<JsonObject> RunAsync(JsonObject input, [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var upgrader = new A2UIV09ActivityUpgrader();
        await foreach (var value in next.RunAsync(A2UIUpgrade.PrepareAgentInput(input, agentVersion), cancellationToken))
            foreach (var item in upgrader.Transform(value)) yield return item;
    }
}

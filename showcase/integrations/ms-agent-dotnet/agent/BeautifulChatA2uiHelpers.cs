using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;

/// <summary>
/// Shared A2UI response builder for generate_a2ui secondary-LLM results.
///
/// Real models routinely invent catalog ids (e.g. <c>sales_dashboard</c>),
/// drop the flat <c>component</c> type field, or omit <c>id</c> — all of which
/// paint as "A2UI render error: Catalog not found / without a type / missing
/// id" on the frontend. D6 fixtures never exercise those paths (GOTCHAS #8).
/// This helper force-pins the catalog, normalises nested/malformed component
/// shapes to the flat catalog form, and drops entries the renderer would
/// reject.
/// </summary>
internal static class BeautifulChatA2ui
{
    internal const string AppDashboardCatalogId = "copilotkit://app-dashboard-catalog";
    internal const string DeclarativeGenUiCatalogId = "declarative-gen-ui-catalog";

    /// <summary>
    /// Secondary-LLM system prompt for the beautiful-chat / app-dashboard catalog.
    /// </summary>
    internal static string DesignSystemPrompt(string catalogId) =>
        "You are an A2UI v0.9 component designer. Emit a single tool call whose\n" +
        "arguments are a JSON object matching this exact shape (no code fences,\n" +
        "no prose outside the tool arguments):\n\n" +
        "{\n" +
        "  \"surfaceId\": string,\n" +
        "  \"catalogId\": \"" + catalogId + "\",\n" +
        "  \"components\": [ ... ],\n" +
        "  \"data\": { }\n" +
        "}\n\n" +
        "CRITICAL:\n" +
        "- catalogId MUST be exactly \"" + catalogId + "\". Never invent another id.\n" +
        "- For each component: set \"id\" to a unique string and \"component\" to the\n" +
        "  type name as a STRING (e.g. \"Metric\", \"PieChart\", \"BarChart\", \"Card\",\n" +
        "  \"Row\", \"Column\", \"Text\", \"DashboardCard\", \"DataTable\", \"Badge\",\n" +
        "  \"StatusBadge\", \"InfoRow\", \"PrimaryButton\", \"Button\", \"FlightCard\").\n" +
        "  Put all props as top-level keys next to id/component.\n" +
        "- Exactly ONE component MUST have id \"root\" (the surface entry point).\n" +
        "- Do NOT invent types like SummaryCard / KPICard / Chart that are not\n" +
        "  listed above. Compose with Card + Metric + PieChart + BarChart instead.\n" +
        "- Pass prop values as inline literals only. Keep top-level \"data\" as {}.\n" +
        "- Example component:\n" +
        "  {\"id\":\"m1\",\"component\":\"Metric\",\"label\":\"Revenue\",\"value\":\"$4.2M\",\"trend\":\"up\",\"trendValue\":\"+12%\"}\n";

    internal static object BuildA2uiResponseFromContent(
        string? content,
        string errorId,
        ILogger logger,
        string? forcedCatalogId = null)
    {
        ArgumentNullException.ThrowIfNull(errorId);
        ArgumentNullException.ThrowIfNull(logger);

        if (string.IsNullOrEmpty(content))
        {
            logger.LogError("GenerateA2ui (errorId={ErrorId}): content was null or empty", errorId);
            return StructuredError("empty_llm_output", "Model returned no text content", "Retry or check model availability", errorId);
        }

        JsonDocument? jsonDoc;
        try
        {
            jsonDoc = JsonDocument.Parse(content);
        }
        catch (JsonException ex)
        {
            logger.LogError(ex, "GenerateA2ui (errorId={ErrorId}): LLM returned malformed JSON", errorId);
            return StructuredError("malformed_llm_output", "The UI generator produced output that was not valid JSON.", "Ask the user to rephrase their request; the model sometimes adds explanatory text around the JSON.", errorId);
        }

        using (jsonDoc)
        {
            try
            {
                var args = jsonDoc.RootElement;
                if (args.ValueKind != JsonValueKind.Object)
                {
                    logger.LogError("GenerateA2ui (errorId={ErrorId}): LLM output was JSON but not an object (kind={Kind})", errorId, args.ValueKind);
                    return StructuredError("malformed_llm_output", "The UI generator output was JSON but not the expected object shape.", "Retry or adjust the prompt.", errorId);
                }

                var surfaceId = args.TryGetProperty("surfaceId", out var sid)
                    ? sid.GetString() ?? "dynamic-surface"
                    : "dynamic-surface";

                // Force the catalog the page registered. Models invent ids like
                // "sales_dashboard" which produce "Catalog not found" at render.
                var catalogId = !string.IsNullOrWhiteSpace(forcedCatalogId)
                    ? forcedCatalogId
                    : args.TryGetProperty("catalogId", out var cid)
                        ? cid.GetString() ?? AppDashboardCatalogId
                        : AppDashboardCatalogId;

                if (!string.IsNullOrWhiteSpace(forcedCatalogId) &&
                    args.TryGetProperty("catalogId", out var rawCid) &&
                    rawCid.GetString() is { } raw &&
                    !string.Equals(raw, forcedCatalogId, StringComparison.Ordinal))
                {
                    logger.LogWarning(
                        "GenerateA2ui (errorId={ErrorId}): overriding LLM catalogId '{Raw}' with forced '{Forced}'",
                        errorId,
                        raw,
                        forcedCatalogId);
                }

                if (!args.TryGetProperty("components", out var componentsElement) ||
                    componentsElement.ValueKind != JsonValueKind.Array)
                {
                    logger.LogError("GenerateA2ui (errorId={ErrorId}): LLM output missing 'components' array", errorId);
                    return StructuredError("malformed_llm_output", "The UI generator output did not include a components array.", "Retry the request.", errorId);
                }

                var components = SanitizeAndNormalizeComponents(componentsElement, logger, errorId);
                if (components.Count == 0)
                {
                    logger.LogError(
                        "GenerateA2ui (errorId={ErrorId}): all components dropped by sanitization",
                        errorId);
                    return StructuredError(
                        "malformed_llm_output",
                        "The UI generator produced no valid components (each needs id + component type).",
                        "Retry the request; the model must emit flat A2UI components with id and component fields.",
                        errorId);
                }

                if (!components.Any(c =>
                        c is JsonObject obj &&
                        obj.TryGetPropertyValue("id", out var idNode) &&
                        idNode is JsonValue idVal &&
                        idVal.GetValue<string>() == "root"))
                {
                    logger.LogWarning(
                        "GenerateA2ui (errorId={ErrorId}): no component with id 'root' — renderer may show empty surface",
                        errorId);
                }

                var operations = new List<object>
                {
                    new { version = "v0.9", createSurface = new { surfaceId, catalogId } },
                    new
                    {
                        version = "v0.9",
                        updateComponents = new
                        {
                            surfaceId,
                            components,
                        },
                    },
                };

                if (args.TryGetProperty("data", out var dataElement) &&
                    dataElement.ValueKind == JsonValueKind.Object &&
                    dataElement.EnumerateObject().Any())
                {
                    operations.Add(new
                    {
                        version = "v0.9",
                        updateDataModel = new
                        {
                            surfaceId,
                            path = "/",
                            value = JsonSerializer.Deserialize<object>(dataElement.GetRawText()),
                        },
                    });
                }

                return new { a2ui_operations = operations };
            }
            catch (JsonException ex)
            {
                logger.LogError(ex, "GenerateA2ui (errorId={ErrorId}): shape deserialization failed", errorId);
                return StructuredError("malformed_llm_output", "The UI generator output did not match the expected structure.", "Retry the request.", errorId);
            }
            catch (ArgumentException ex)
            {
                logger.LogError(ex, "GenerateA2ui (errorId={ErrorId}): argument validation failed", errorId);
                return StructuredError("invalid_argument", "One of the arguments was invalid.", "Check the request shape and retry.", errorId);
            }
        }
    }

    /// <summary>
    /// Drop empty entries, normalise nested type shapes to flat
    /// <c>{ id, component, ...props }</c>, and unstringify JSON-as-string
    /// fields the model sometimes emits for chart data.
    /// </summary>
    internal static List<object> SanitizeAndNormalizeComponents(
        JsonElement componentsElement,
        ILogger logger,
        string errorId)
    {
        var result = new List<object>();
        if (componentsElement.ValueKind != JsonValueKind.Array)
        {
            return result;
        }

        foreach (var entry in componentsElement.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var normalized = NormalizeComponent(entry);
            if (normalized is null)
            {
                logger.LogWarning(
                    "GenerateA2ui (errorId={ErrorId}): dropping component missing id/component: {Raw}",
                    errorId,
                    Truncate(entry.GetRawText(), 200));
                continue;
            }

            result.Add(normalized);
        }

        return result;
    }

    /// <summary>
    /// Convert one raw LLM component object into the flat catalog shape, or
    /// null if it cannot be salvaged.
    ///
    /// Handles:
    /// - already-flat: <c>{ "id":"x", "component":"Metric", "label":"..." }</c>
    /// - nested type object: <c>{ "id":"x", "component": { "Metric": { ... } } }</c>
    /// - type-as-key: <c>{ "id":"x", "Metric": { "label":"..." } }</c>
    /// - type-as-key without id: <c>{ "Metric": { "id":"x", ... } }</c> (rare)
    /// </summary>
    internal static JsonObject? NormalizeComponent(JsonElement entry)
    {
        if (entry.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var obj = JsonNode.Parse(entry.GetRawText()) as JsonObject;
        if (obj is null)
        {
            return null;
        }

        // Nested component: { id, component: { TypeName: { props } } }
        if (obj.TryGetPropertyValue("component", out var componentNode) &&
            componentNode is JsonObject nestedType &&
            nestedType.Count == 1)
        {
            var (typeName, propsNode) = nestedType.First();
            var flat = new JsonObject { ["component"] = typeName };
            if (obj.TryGetPropertyValue("id", out var nestedId) && nestedId is not null)
            {
                flat["id"] = nestedId.DeepClone();
            }
            if (propsNode is JsonObject props)
            {
                foreach (var prop in props)
                {
                    if (prop.Key is "id" or "component")
                    {
                        continue;
                    }
                    flat[prop.Key] = prop.Value?.DeepClone();
                }
            }
            obj = flat;
        }

        // Type-as-key: { id?, Metric: { ...props } } with no string "component"
        if (!HasStringComponent(obj))
        {
            string? typeName = null;
            JsonObject? props = null;
            string? id = obj.TryGetPropertyValue("id", out var idNode) && idNode is JsonValue
                ? idNode.GetValue<string>()
                : null;

            foreach (var prop in obj)
            {
                if (prop.Key is "id" or "component" or "weight" or "slotName")
                {
                    continue;
                }
                if (prop.Value is JsonObject candidate && IsLikelyTypeName(prop.Key))
                {
                    typeName = prop.Key;
                    props = candidate;
                    break;
                }
            }

            if (typeName is not null)
            {
                var flat = new JsonObject { ["component"] = typeName };
                if (id is not null)
                {
                    flat["id"] = id;
                }
                else if (props is not null &&
                         props.TryGetPropertyValue("id", out var propsId) &&
                         propsId is JsonValue propsIdVal)
                {
                    flat["id"] = propsIdVal.GetValue<string>();
                }

                if (props is not null)
                {
                    foreach (var prop in props)
                    {
                        if (prop.Key is "id" or "component")
                        {
                            continue;
                        }
                        flat[prop.Key] = prop.Value?.DeepClone();
                    }
                }
                obj = flat;
            }
        }

        // Require id + string component after normalisation.
        if (!obj.TryGetPropertyValue("id", out var finalId) ||
            finalId is not JsonValue finalIdVal ||
            string.IsNullOrWhiteSpace(finalIdVal.GetValue<string>()))
        {
            return null;
        }
        if (!HasStringComponent(obj))
        {
            return null;
        }

        UnstringifyJsonFields(obj);
        return obj;
    }

    private static bool HasStringComponent(JsonObject obj) =>
        obj.TryGetPropertyValue("component", out var c) &&
        c is JsonValue v &&
        v.TryGetValue<string>(out var s) &&
        !string.IsNullOrWhiteSpace(s);

    private static bool IsLikelyTypeName(string key) =>
        key.Length > 0 && char.IsUpper(key[0]) && !key.Contains(' ', StringComparison.Ordinal);

    private static void UnstringifyJsonFields(JsonObject obj)
    {
        foreach (var field in new[] { "data", "value", "children", "rows", "columns" })
        {
            if (!obj.TryGetPropertyValue(field, out var node) || node is not JsonValue val)
            {
                continue;
            }
            if (!val.TryGetValue<string>(out var s) || string.IsNullOrWhiteSpace(s))
            {
                continue;
            }
            var trimmed = s.Trim();
            if (trimmed.Length == 0 || (trimmed[0] is not '[' and not '{'))
            {
                continue;
            }
            try
            {
                var parsed = JsonNode.Parse(trimmed);
                if (parsed is not null)
                {
                    obj[field] = parsed;
                }
            }
            catch (JsonException)
            {
                // Leave the raw string; renderer may still handle it.
            }
        }
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max] + "...";

    internal static object StructuredError(string category, string message, string remediation, string errorId) =>
        new
        {
            error = category,
            message,
            remediation,
            errorId,
        };
}

using System.Text.Json.Nodes;

namespace CopilotKit.Intelligence;

/// <summary>Semantic validation matching a2ui-toolkit 0.0.4. Streaming validation intentionally defers data bindings.</summary>
internal static class A2UIValidation
{
    public static JsonArray ValidateComponents(JsonArray components, JsonObject? catalog = null)
    {
        var errors = new JsonArray();
        void Error(string code, string path, string message) => errors.Add(new JsonObject { ["code"] = code, ["path"] = path, ["message"] = message });
        if (components.Count == 0) { Error("empty_components", "components", "A2UI components must be a non-empty array"); return errors; }
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var comp in components)
        {
            var id = Text((comp as JsonObject)?["id"]);
            if (id is not null && !ids.Add(id)) Error("duplicate_id", $"components[id={id}]", $"Duplicate component id '{id}'");
        }
        var edges = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        for (var i = 0; i < components.Count; i++)
        {
            var comp = components[i] as JsonObject; var id = Text(comp?["id"]); var type = Text(comp?["component"]);
            if (string.IsNullOrEmpty(id)) Error("missing_id", $"components[{i}].id", $"Component at index {i} is missing a string 'id'");
            if (string.IsNullOrEmpty(type)) Error("missing_component_type", $"components[{i}].component", $"Component at index {i} is missing a string 'component' type");
            var schema = type is null ? null : catalog?["components"]?[type] as JsonObject;
            if (catalog is not null && type is not null)
            {
                if (schema is null) Error("unknown_component", $"components[{i}].component", $"Component type '{type}' is not in the catalog");
                else foreach (var required in schema["required"] as JsonArray ?? [])
                {
                    var field = Text(required);
                    if (field is not null && comp?.ContainsKey(field) != true) Error("missing_required_prop", $"components[{i}].{field}", $"Component '{type}' (index {i}) is missing required prop '{field}'");
                }
            }
            if (comp is null) continue;
            var references = References(comp, schema).ToList();
            foreach (var (path, target) in references) if (!ids.Contains(target)) Error("unresolved_child", $"components[{i}].{path}", $"Child reference '{target}' does not match any component id");
            if (id is not null) edges[id] = references.Select(reference => reference.Target).ToList();
        }
        // Iterative DFS prevents untrusted, deeply nested graphs exhausting the native stack.
        var colors = new Dictionary<string, int>(StringComparer.Ordinal); var found = new HashSet<string>(StringComparer.Ordinal);
        foreach (var root in edges.Keys)
        {
            if (colors.GetValueOrDefault(root) != 0) continue;
            var stack = new Stack<(string Id, int Index)>(); var path = new List<string> { root }; stack.Push((root, 0)); colors[root] = 1;
            while (stack.TryPop(out var frame))
            {
                var children = edges.GetValueOrDefault(frame.Id) ?? [];
                if (frame.Index >= children.Count) { colors[frame.Id] = 2; path.RemoveAt(path.Count - 1); continue; }
                stack.Push((frame.Id, frame.Index + 1)); var child = children[frame.Index];
                if (colors.GetValueOrDefault(child) == 0) { colors[child] = 1; path.Add(child); stack.Push((child, 0)); }
                else if (colors[child] == 1)
                {
                    var cycle = path.Skip(path.IndexOf(child)).ToList();
                    var minimum = cycle.Select((value, index) => (value, index)).OrderBy(pair => pair.value, StringComparer.Ordinal).First().index;
                    cycle = cycle.Skip(minimum).Concat(cycle.Take(minimum)).ToList();
                    if (found.Add(string.Join('\0', cycle))) Error("child_cycle", $"components[id={cycle[0]}]", "Child reference cycle detected: " + string.Join(" -> ", cycle.Append(cycle[0])));
                }
            }
        }
        if (!ids.Contains("root")) Error("no_root", "components", "No component has id 'root'");
        return errors;
    }

    internal static string? Text(JsonNode? value) => value is JsonValue item && item.TryGetValue<string>(out var text) ? text : null;
    private static IEnumerable<(string Path, string Target)> References(JsonObject comp, JsonObject? schema)
    {
        foreach (var edge in FieldRefs("child", comp["child"], false)) yield return edge;
        foreach (var edge in FieldRefs("children", comp["children"], true)) yield return edge;
        foreach (var prop in schema?["properties"] as JsonObject ?? [])
        {
            if (prop.Key is "child" or "children" || prop.Value is not JsonObject definition) continue;
            var format = Text(definition["format"]);
            if (format is "componentRef" or "componentRefList")
            {
                foreach (var edge in FieldRefs(prop.Key, comp[prop.Key], format == "componentRefList")) yield return edge;
            }
            else if (Text(definition["type"]) == "array" && definition["items"]?["properties"] is JsonObject itemProps && comp[prop.Key] is JsonArray array)
            {
                for (var i = 0; i < array.Count; i++)
                {
                    if (array[i] is not JsonObject item) continue;
                    foreach (var sub in itemProps)
                    {
                        var subFormat = Text(sub.Value?["format"]);
                        if (subFormat is "componentRef" or "componentRefList") foreach (var edge in FieldRefs($"{prop.Key}[{i}].{sub.Key}", item[sub.Key], subFormat == "componentRefList")) yield return edge;
                    }
                }
            }
        }
    }
    private static IEnumerable<(string Path, string Target)> FieldRefs(string field, JsonNode? value, bool list)
    {
        if (value is JsonArray array)
        {
            for (var i = 0; i < array.Count; i++) foreach (var reference in BareRefs(array[i])) yield return (list ? $"{field}[{i}]" : field, reference);
        }
        else foreach (var reference in BareRefs(value)) yield return (field, reference);
    }
    private static IEnumerable<string> BareRefs(JsonNode? value)
    {
        if (Text(value) is { } text) yield return text;
        else if (value is JsonObject obj && Text(obj["componentId"]) is { } id) yield return id;
    }
}

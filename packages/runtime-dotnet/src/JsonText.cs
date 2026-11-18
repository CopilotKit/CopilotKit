using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace CopilotKit.Intelligence;

/// <summary>JSON read and written like JavaScript, so prompts and payloads match the TypeScript runtime.</summary>
internal static class JsonText
{
    private static readonly JsonDocumentOptions ParseOptions = new() { MaxDepth = 256 };

    /// <summary>Serialize like <c>JSON.stringify</c>: no whitespace and no escaping beyond what JSON requires.</summary>
    internal static string Compact(JsonNode? node)
    {
        var builder = new StringBuilder();
        Write(builder, node);
        return builder.ToString();
    }

    /// <summary>Parse like <c>JSON.parse</c>: a repeated key keeps its last value. Throws <see cref="JsonException"/>.</summary>
    internal static JsonNode? Parse(string text)
    {
        using var document = JsonDocument.Parse(text, ParseOptions);
        return From(document.RootElement);
    }

    /// <summary>Parse, or false for text that is not JSON.</summary>
    internal static bool TryParse(string? text, out JsonNode? node)
    {
        node = null;
        if (text is null) return false;
        try { node = Parse(text); return true; }
        catch (JsonException) { return false; }
    }

    internal static string? Str(JsonNode? node) => node is JsonValue value && value.GetValueKind() == JsonValueKind.String ? value.GetValue<string>() : null;
    internal static bool IsString(JsonNode? node) => Str(node) is not null;
    internal static bool NonEmpty(JsonNode? node) => Str(node) is { Length: > 0 };
    internal static bool IsNumber(JsonNode? node) => node is JsonValue value && value.GetValueKind() == JsonValueKind.Number;
    internal static bool IsBool(JsonNode? node) => node is JsonValue value && value.GetValueKind() is JsonValueKind.True or JsonValueKind.False;
    internal static bool IsFalse(JsonNode? node) => node is JsonValue value && value.GetValueKind() == JsonValueKind.False;

    /// <summary>The value of a JSON number, however the node stores it.</summary>
    internal static double Number(JsonNode node) => double.Parse(node.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture);

    /// <summary>JavaScript truthiness of a JSON value.</summary>
    internal static bool Truthy(JsonNode? node) => node switch
    {
        null => false,
        JsonObject or JsonArray => true,
        _ => node.GetValueKind() switch
        {
            JsonValueKind.True => true,
            JsonValueKind.String => node.GetValue<string>().Length > 0,
            JsonValueKind.Number => Number(node) != 0,
            _ => false
        }
    };

    private static JsonNode? From(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                var result = new JsonObject();
                foreach (var property in element.EnumerateObject()) result[property.Name] = From(property.Value);
                return result;
            case JsonValueKind.Array: return new JsonArray(element.EnumerateArray().Select(From).ToArray());
            case JsonValueKind.String: return JsonValue.Create(element.GetString());
            case JsonValueKind.True: return JsonValue.Create(true);
            case JsonValueKind.False: return JsonValue.Create(false);
            case JsonValueKind.Null: return null;
            default: return JsonValue.Create(element.Clone());
        }
    }

    private static void Write(StringBuilder builder, JsonNode? node)
    {
        switch (node)
        {
            case null: builder.Append("null"); return;
            case JsonObject value:
                builder.Append('{');
                var first = true;
                foreach (var (key, item) in value)
                {
                    if (!first) builder.Append(',');
                    first = false;
                    Quote(builder, key); builder.Append(':'); Write(builder, item);
                }
                builder.Append('}');
                return;
            case JsonArray array:
                builder.Append('[');
                for (var index = 0; index < array.Count; index++)
                {
                    if (index > 0) builder.Append(',');
                    Write(builder, array[index]);
                }
                builder.Append(']');
                return;
            default:
                if (Str(node) is { } text) Quote(builder, text);
                else builder.Append(node.ToJsonString());
                return;
        }
    }

    private static void Quote(StringBuilder builder, string text)
    {
        builder.Append('"');
        for (var index = 0; index < text.Length; index++)
        {
            var character = text[index];
            switch (character)
            {
                case '"': builder.Append("\\\""); break;
                case '\\': builder.Append("\\\\"); break;
                case '\b': builder.Append("\\b"); break;
                case '\f': builder.Append("\\f"); break;
                case '\n': builder.Append("\\n"); break;
                case '\r': builder.Append("\\r"); break;
                case '\t': builder.Append("\\t"); break;
                default:
                    var lone = char.IsHighSurrogate(character) ? index + 1 >= text.Length || !char.IsLowSurrogate(text[index + 1])
                        : char.IsLowSurrogate(character) && (index == 0 || !char.IsHighSurrogate(text[index - 1]));
                    if (character < 0x20 || lone) builder.Append("\\u").Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                    else builder.Append(character);
                    break;
            }
        }
        builder.Append('"');
    }
}

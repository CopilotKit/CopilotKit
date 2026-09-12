using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace CopilotKit.Intelligence;

/// <summary>Reads complete values from incomplete JSON without guessing closing strings or objects.</summary>
internal static class PartialJson
{
    internal static (JsonArray Items, bool Closed)? DataArray(string text, string name)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        var reader = new Utf8JsonReader(bytes, false, default);
        try
        {
            while (reader.Read())
            {
                if (reader.TokenType != JsonTokenType.PropertyName || reader.CurrentDepth != 1 || reader.GetString() != "data") continue;
                if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject) return null;
                return Array(Encoding.UTF8.GetString(bytes.AsSpan((int)reader.TokenStartIndex)), name);
            }
        }
        catch (JsonException) { }
        return null;
    }
    internal static JsonNode? Field(string text, string name, int depth = 1)
    {
        var reader = new Utf8JsonReader(Encoding.UTF8.GetBytes(text), false, default);
        try
        {
            while (reader.Read())
            {
                if (reader.TokenType != JsonTokenType.PropertyName || reader.CurrentDepth != depth || reader.GetString() != name) continue;
                if (!reader.Read() || !JsonDocument.TryParseValue(ref reader, out var document)) return null;
                using (document) return JsonNode.Parse(document.RootElement.GetRawText());
            }
        }
        catch (JsonException) { }
        return null;
    }
    internal static (JsonArray Items, bool Closed)? Array(string text, string name, int depth = 1)
    {
        var reader = new Utf8JsonReader(Encoding.UTF8.GetBytes(text), false, default);
        try
        {
            while (reader.Read())
            {
                if (reader.TokenType != JsonTokenType.PropertyName || reader.CurrentDepth != depth || reader.GetString() != name) continue;
                if (!reader.Read() || reader.TokenType != JsonTokenType.StartArray) return null;
                var items = new JsonArray();
                while (reader.Read())
                {
                    if (reader.TokenType == JsonTokenType.EndArray) return (items, true);
                    if (!JsonDocument.TryParseValue(ref reader, out var document)) return (items, false);
                    using (document) items.Add(JsonNode.Parse(document.RootElement.GetRawText()));
                }
                return (items, false);
            }
        }
        catch (JsonException) { }
        return null;
    }
}

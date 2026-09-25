using System.Runtime.CompilerServices;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;

namespace CopilotKit.Intelligence;

/// <summary>An AG-UI HTTP agent. Only explicit server-configured headers are forwarded.</summary>
public sealed class HttpAgent(Uri url, HttpClient client, string description = "", IReadOnlyDictionary<string, string>? headers = null) : IRuntimeAgent
{
    public string Description { get; } = description;
    public async IAsyncEnumerable<JsonObject> RunAsync(JsonObject input, [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(input) };
        request.Headers.Accept.ParseAdd("text/event-stream");
        foreach (var pair in headers ?? new Dictionary<string, string>()) request.Headers.TryAddWithoutValidation(pair.Key, pair.Value);
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode) throw new RuntimeRequestException(502, "Agent request failed");
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var reader = new StreamReader(stream, Encoding.UTF8);
        var data = new StringBuilder();
        while (await reader.ReadLineAsync(cancellationToken) is { } line)
        {
            if (line.Length == 0)
            {
                if (data.Length == 0) continue;
                var text = data.ToString().TrimEnd('\n'); data.Clear();
                if (text == "[DONE]") break;
                yield return ParseEvent(text);
            }
            else if (line.StartsWith("data:", StringComparison.Ordinal))
            {
                data.Append(line[5..].TrimStart(' ')).Append('\n');
                if (data.Length > 4 * 1024 * 1024) throw new RuntimeRequestException(502, "Agent event exceeds the size limit");
            }
        }
        if (data.Length > 0 && data.ToString().Trim() != "[DONE]") yield return ParseEvent(data.ToString());
    }

    /// <summary>Validate both terminated frames and the final unterminated frame.</summary>
    private static JsonObject ParseEvent(string text)
    {
        if (JsonNode.Parse(text) is not JsonObject value || value["type"] is null) throw new RuntimeRequestException(502, "Agent returned an invalid AG-UI event");
        return value;
    }
}

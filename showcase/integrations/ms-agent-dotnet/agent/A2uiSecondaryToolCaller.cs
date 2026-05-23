using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

internal static class A2uiSecondaryToolCaller
{
    private const string DefaultOpenAiEndpoint = "https://models.inference.ai.azure.com";
    private const string DesignToolName = "_design_a2ui_surface";

    internal static async Task<string?> GetDesignToolArgumentsAsync(
        IConfiguration configuration,
        string systemPrompt,
        string userContent,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(systemPrompt);
        ArgumentNullException.ThrowIfNull(userContent);

        var endpoint = (Environment.GetEnvironmentVariable("OPENAI_BASE_URL") ?? DefaultOpenAiEndpoint).TrimEnd('/');
        var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
            ?? configuration["OPENAI_API_KEY"]
            ?? configuration["GitHubToken"]
            ?? "sk-mock-local";

        using var httpClient = new HttpClient
        {
            BaseAddress = new Uri(endpoint + "/"),
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, "chat/completions");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        foreach (var header in AimockHeaderContext.Get())
        {
            request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }

        var payload = new
        {
            model = "gpt-4.1",
            messages = new object[]
            {
                new { role = "system", content = systemPrompt },
                new { role = "user", content = userContent },
            },
            tools = new object[]
            {
                new
                {
                    type = "function",
                    function = new
                    {
                        name = DesignToolName,
                        description = "Render a dynamic A2UI v0.9 surface.",
                        parameters = new
                        {
                            type = "object",
                            properties = new Dictionary<string, object>
                            {
                                ["surfaceId"] = new { type = "string" },
                                ["catalogId"] = new { type = "string" },
                                ["components"] = new { type = "array", items = new { type = "object" } },
                                ["data"] = new { type = "object" },
                            },
                            required = new[] { "surfaceId", "catalogId", "components" },
                        },
                    },
                },
            },
            tool_choice = new
            {
                type = "function",
                function = new { name = DesignToolName },
            },
        };

        request.Content = new StringContent(
            JsonSerializer.Serialize(payload),
            Encoding.UTF8,
            "application/json");

        using var response = await httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        using var document = JsonDocument.Parse(body);
        if (!document.RootElement.TryGetProperty("choices", out var choices) ||
            choices.ValueKind != JsonValueKind.Array ||
            choices.GetArrayLength() == 0)
        {
            return null;
        }

        var message = choices[0].GetProperty("message");
        if (!message.TryGetProperty("tool_calls", out var toolCalls) ||
            toolCalls.ValueKind != JsonValueKind.Array ||
            toolCalls.GetArrayLength() == 0)
        {
            return null;
        }

        var function = toolCalls[0].GetProperty("function");
        var toolName = function.TryGetProperty("name", out var nameElement)
            ? nameElement.GetString()
            : null;
        if (!string.Equals(toolName, DesignToolName, StringComparison.Ordinal))
        {
            return null;
        }

        if (!function.TryGetProperty("arguments", out var argumentsElement))
        {
            return null;
        }

        return argumentsElement.ValueKind == JsonValueKind.String
            ? argumentsElement.GetString()
            : argumentsElement.GetRawText();
    }
}

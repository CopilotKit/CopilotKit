using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

internal static class A2uiSecondaryToolCaller
{
    private const string DesignToolName = "_design_a2ui_surface";
    private const int MaxBodyLogLength = 1024;

    internal static async Task<string?> GetDesignToolArgumentsAsync(
        IConfiguration configuration,
        string systemPrompt,
        string userContent,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(systemPrompt);
        ArgumentNullException.ThrowIfNull(userContent);
        ArgumentNullException.ThrowIfNull(logger);

        var endpoint = ApiKeyResolver.ResolveEndpoint(configuration).TrimEnd('/');
        var apiKey = ApiKeyResolver.ResolveApiKey(configuration, logger);

        using var httpClient = new HttpClient
        {
            BaseAddress = new Uri(endpoint + "/"),
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, "chat/completions");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        // Forward the inbound x-* headers (incl. x-aimock-context) read off the
        // current request's HttpContext.Items via the seeded accessor. This
        // secondary outbound call runs on the SSE-pump ExecutionContext, so it
        // must read through the accessor (not a middleware-set AsyncLocal) for
        // the value to be present at call time.
        if (AimockHeaderPolicy.HttpContextAccessor?.HttpContext is null)
        {
            CvDiag.Logger?.LogWarning("A2uiSecondaryToolCaller: no HttpContext resolved (HttpContextAccessor null or no request in scope); forwarding empty x-* header set — x-aimock-context will be absent on the secondary call.");
        }
        foreach (var header in AimockHeaderContext.Get(AimockHeaderPolicy.HttpContextAccessor?.HttpContext))
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

        if (!response.IsSuccessStatusCode)
        {
            var truncated = body.Length > MaxBodyLogLength
                ? body[..MaxBodyLogLength] + "...[truncated]"
                : body;
            logger.LogWarning(
                "[a2ui-secondary] upstream returned non-success status {Status}: {Body}",
                (int)response.StatusCode,
                truncated);
            response.EnsureSuccessStatusCode();
        }

        using var document = JsonDocument.Parse(body);
        if (!document.RootElement.TryGetProperty("choices", out var choices) ||
            choices.ValueKind != JsonValueKind.Array ||
            choices.GetArrayLength() == 0)
        {
            logger.LogWarning("[a2ui-secondary] response missing or empty 'choices' array");
            return null;
        }

        if (!choices[0].TryGetProperty("message", out var message))
        {
            logger.LogWarning("[a2ui-secondary] choices[0] missing 'message' field");
            return null;
        }

        if (!message.TryGetProperty("tool_calls", out var toolCalls) ||
            toolCalls.ValueKind != JsonValueKind.Array ||
            toolCalls.GetArrayLength() == 0)
        {
            logger.LogWarning("[a2ui-secondary] message missing or empty 'tool_calls' array");
            return null;
        }

        if (!toolCalls[0].TryGetProperty("function", out var function))
        {
            logger.LogWarning("[a2ui-secondary] tool_calls[0] missing 'function' field");
            return null;
        }

        var toolName = function.TryGetProperty("name", out var nameElement)
            ? nameElement.GetString()
            : null;
        if (!string.Equals(toolName, DesignToolName, StringComparison.Ordinal))
        {
            logger.LogWarning(
                "[a2ui-secondary] unexpected tool name (expected {Expected}, got {Actual})",
                DesignToolName,
                toolName ?? "<null>");
            return null;
        }

        if (!function.TryGetProperty("arguments", out var argumentsElement))
        {
            logger.LogWarning("[a2ui-secondary] function missing 'arguments' field");
            return null;
        }

        return argumentsElement.ValueKind == JsonValueKind.String
            ? argumentsElement.GetString()
            : argumentsElement.GetRawText();
    }
}

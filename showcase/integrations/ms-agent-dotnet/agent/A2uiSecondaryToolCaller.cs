using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

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

        // Fail loud if no credential resolves — matches the primary
        // SalesAgentFactory, which throws when GitHubToken is absent. Previously
        // this fell back to a bogus "sk-mock-local" key, which got sent verbatim
        // to whatever real endpoint OPENAI_BASE_URL pointed at, producing a
        // confusing 401 from upstream instead of a clear local configuration
        // error. aimock-backed test runs still resolve a real key via the
        // GitHubToken fallback (aimock is selected by OPENAI_BASE_URL + the
        // forwarded x-aimock-context header, not by a sentinel key), so no
        // mock-mode gate is needed here.
        var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
            ?? configuration["OPENAI_API_KEY"]
            ?? configuration["GitHubToken"]
            ?? throw new InvalidOperationException(
                "No OpenAI credential found for the A2UI secondary tool caller. " +
                "Set the OPENAI_API_KEY environment variable, or provide OPENAI_API_KEY / " +
                "GitHubToken in configuration (e.g. dotnet user-secrets set GitHubToken \"<your-token>\" " +
                "or get it using: gh auth token).");

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

        // Don't use EnsureSuccessStatusCode(): the HttpRequestException it
        // throws carries the status code but discards the response body we
        // already read. Throw our own with a truncated body so the upstream
        // detail (e.g. the provider's error message for a 401/429) is captured
        // for server-side logging, and so the StatusCode survives for the
        // caller to classify retryable vs non-retryable failures.
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(
                $"A2UI secondary tool caller upstream returned {(int)response.StatusCode} " +
                $"({response.StatusCode}). Body: {Truncate(body, 2048)}",
                inner: null,
                statusCode: response.StatusCode);
        }

        // A successful HTTP status but a structurally-malformed body must not
        // surface as an uncaught KeyNotFoundException from a bare GetProperty.
        // Parse defensively, capture the body for logging, and raise a typed
        // signal the caller maps to a specific structured error.
        return ParseDesignToolArguments(body);
    }

    /// <summary>
    /// Parses the chat-completions response body and extracts the
    /// <c>_design_a2ui_surface</c> tool-call arguments. Returns <c>null</c> for
    /// the expected "no usable tool call" cases (missing/empty choices, missing
    /// tool_calls, wrong tool name, missing arguments). Throws
    /// <see cref="A2uiUpstreamResponseException"/> for a structurally-malformed
    /// response (e.g. a choice with no <c>message</c>, or a tool call with no
    /// <c>function</c>) so the caller can return a specific structured error
    /// with the upstream body captured for logging — rather than letting an
    /// uncaught <see cref="KeyNotFoundException"/> escape.
    /// </summary>
    internal static string? ParseDesignToolArguments(string body)
    {
        ArgumentNullException.ThrowIfNull(body);

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(body);
        }
        catch (JsonException ex)
        {
            throw new A2uiUpstreamResponseException(
                "Upstream returned a 2xx status but a non-JSON body.", body, ex);
        }

        using (document)
        {
            if (!document.RootElement.TryGetProperty("choices", out var choices) ||
                choices.ValueKind != JsonValueKind.Array ||
                choices.GetArrayLength() == 0)
            {
                return null;
            }

            // choices[0] exists (length checked above), but "message" may be
            // absent on a malformed response — guard the deref.
            if (!choices[0].TryGetProperty("message", out var message))
            {
                throw new A2uiUpstreamResponseException(
                    "Upstream choice had no 'message' property.", body);
            }

            if (!message.TryGetProperty("tool_calls", out var toolCalls) ||
                toolCalls.ValueKind != JsonValueKind.Array ||
                toolCalls.GetArrayLength() == 0)
            {
                return null;
            }

            // toolCalls[0] exists (length checked above), but "function" may be
            // absent on a malformed response — guard the deref.
            if (!toolCalls[0].TryGetProperty("function", out var function))
            {
                throw new A2uiUpstreamResponseException(
                    "Upstream tool call had no 'function' property.", body);
            }

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

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max] + "…(truncated)";
}

/// <summary>
/// Raised when the A2UI secondary tool caller's upstream returns a 2xx status
/// but a body that is non-JSON or structurally missing the expected
/// <c>choices[].message</c> / <c>tool_calls[].function</c> shape. Carries the
/// (truncated) response <see cref="Body"/> so the caller can log the upstream
/// detail with a correlation id before returning a structured error.
/// </summary>
internal sealed class A2uiUpstreamResponseException : Exception
{
    public string Body { get; }

    public A2uiUpstreamResponseException(string message, string body)
        : base(message) => Body = body;

    public A2uiUpstreamResponseException(string message, string body, Exception inner)
        : base(message, inner) => Body = body;
}

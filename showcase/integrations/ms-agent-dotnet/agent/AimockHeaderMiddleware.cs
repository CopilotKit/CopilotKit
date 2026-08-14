// STOPGAP: This integration-level header propagation replaces once copilotkit-sdk-dotnet
// ships (Microsoft contribution, ETA mid-2026). When that SDK lands, delete this code
// and use the SDK's built-in header propagation.
// See: https://www.notion.so/copilotkit/3543aa3818528150b6acc5b872ad7fe5

// TODO(copilotkit-sdk-dotnet): migrate to SDK-level header propagation
public class AimockHeaderMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<AimockHeaderMiddleware> _logger;

    public AimockHeaderMiddleware(RequestDelegate next, ILogger<AimockHeaderMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var headers = context.Request.Headers
            .Where(h => h.Key.StartsWith("x-", StringComparison.OrdinalIgnoreCase))
            .ToDictionary(h => h.Key, h => h.Value.ToString());
        // Stash on HttpContext.Items (NOT an AsyncLocal): the value must survive
        // the AG-UI SSE-pump ExecutionContext boundary so the outbound-LLM policy
        // can read it via IHttpContextAccessor at call time.
        AimockHeaderContext.Set(context, headers);
        await TryStashLastUserMessageAsync(context);
        // CVDIAG inbound breadcrumb: the x-* headers (incl. x-diag-run-id /
        // x-diag-hops / x-aimock-context) have now been captured onto
        // HttpContext.Items for this request.
        CvDiag.LogInbound(_logger, "backend-ms-agent-dotnet", AimockHeaderContext.Get(context));
        // No finally-wipe: the captured headers are request-scoped — they live on
        // this request's HttpContext and die with it. Wiping them in a finally
        // raced the still-pumping SSE response and could clear the value before
        // the outbound LLM call read it.
        await _next(context);
    }

    private static async Task TryStashLastUserMessageAsync(HttpContext context)
    {
        try
        {
            context.Request.EnableBuffering();
            using var reader = new StreamReader(context.Request.Body, leaveOpen: true);
            var body = await reader.ReadToEndAsync();
            context.Request.Body.Position = 0;
            AimockHeaderContext.SetLastUserMessage(context, ExtractLastUserText(body));
        }
        catch
        {
            try { context.Request.Body.Position = 0; } catch { /* ignore */ }
        }
    }

    private static string? ExtractLastUserText(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(body);
            if (!doc.RootElement.TryGetProperty("messages", out var messages) ||
                messages.ValueKind != System.Text.Json.JsonValueKind.Array)
            {
                return null;
            }
            for (var i = messages.GetArrayLength() - 1; i >= 0; i--)
            {
                var msg = messages[i];
                var role = msg.TryGetProperty("role", out var roleEl) ? roleEl.GetString() : null;
                if (!string.Equals(role, "user", StringComparison.OrdinalIgnoreCase)) continue;
                if (msg.TryGetProperty("content", out var content) &&
                    content.ValueKind == System.Text.Json.JsonValueKind.String)
                {
                    var text = content.GetString();
                    if (!string.IsNullOrWhiteSpace(text)) return text;
                }
            }
        }
        catch (System.Text.Json.JsonException)
        {
            return null;
        }
        return null;
    }
}

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
}

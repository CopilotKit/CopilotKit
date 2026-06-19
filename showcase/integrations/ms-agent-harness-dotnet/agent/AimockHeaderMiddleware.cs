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
        // Use case-insensitive comparer because ASP.NET's IHeaderDictionary is itself
        // case-insensitive, but iterating its underlying store can in rare cases yield
        // case-variant duplicates (e.g., a misbehaving proxy injecting both `X-Foo`
        // and `x-foo`). With the default ordinal comparer, ToDictionary would throw
        // ArgumentException on duplicate keys and fail the request.
        //
        // When such a collision occurs, we keep the first value because HTTP has no
        // canonical merge rule for case-variant headers across distinct keys (joining
        // with comma would only be defined if the keys were ASCII-equal). We log a
        // warning so operators can see that an upstream proxy is misbehaving and that
        // downstream consumers may be observing only one of several values.
        var groupedHeaders = context.Request.Headers
            .Where(h => h.Key.StartsWith("x-", StringComparison.OrdinalIgnoreCase))
            .GroupBy(h => h.Key, StringComparer.OrdinalIgnoreCase)
            .ToList();

        foreach (var group in groupedHeaders.Where(g => g.Count() > 1))
        {
            _logger.LogWarning(
                "[aimock-header-middleware] header '{Key}' arrived with {Count} case-variant entries; keeping the first ('{Kept}'), dropping {DroppedCount} others",
                group.Key, group.Count(), group.First().Value.ToString(), group.Count() - 1);
        }

        var headers = groupedHeaders.ToDictionary(
            g => g.First().Key,
            g => g.First().Value.ToString(),
            StringComparer.OrdinalIgnoreCase);
        // Stash on HttpContext.Items (NOT an AsyncLocal): the value must survive
        // the AG-UI SSE-pump ExecutionContext boundary so the outbound-LLM policy
        // can read it via IHttpContextAccessor at call time. For streaming
        // endpoints (AG-UI uses IAsyncEnumerable/SSE) the response delegate
        // continues writing — and may invoke downstream OpenAI calls — AFTER
        // _next returns; the captured headers live on this request's HttpContext
        // and die with it, so there is no finally-wipe to race the SSE tail.
        AimockHeaderContext.Set(context, headers);
        // CVDIAG inbound breadcrumb: the x-* headers (incl. x-diag-run-id /
        // x-diag-hops / x-aimock-context) have now been captured onto
        // HttpContext.Items for this request.
        CvDiag.LogInbound(_logger, "backend-ms-agent-harness-dotnet", AimockHeaderContext.Get(context));
        await _next(context);
    }
}

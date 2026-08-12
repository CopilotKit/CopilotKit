// STOPGAP: This integration-level header propagation replaces once copilotkit-sdk-dotnet
// ships (Microsoft contribution, ETA mid-2026). When that SDK lands, delete this code
// and use the SDK's built-in header propagation.
// See: https://www.notion.so/copilotkit/3543aa3818528150b6acc5b872ad7fe5

using Microsoft.AspNetCore.Http;

// TODO(copilotkit-sdk-dotnet): migrate to SDK-level header propagation
//
// The forwarded x-* headers are stashed in HttpContext.Items rather than an
// AsyncLocal. HttpContext flows across the AG-UI SSE-pump ExecutionContext
// boundary (the server seeds IHttpContextAccessor's holder at request entry,
// before any middleware, and all branches of the request's async tree share
// that holder), whereas a middleware-set AsyncLocal is captured in a snapshot
// that the deep outbound-LLM call site does NOT inherit. The previous
// AsyncLocal approach therefore lost the header at outbound-call time and the
// mock LLM server (aimock, strict mode) returned 503.
public static class AimockHeaderContext
{
    // Key under which the filtered x-* header map is stored on HttpContext.Items.
    private const string ItemsKey = "__aimock_forwarded_headers__";

    /// <summary>
    /// Stash the inbound x-* headers onto the request's HttpContext.Items so the
    /// outbound policy can read them at LLM-call time, regardless of which
    /// ExecutionContext branch the SSE pump is running on.
    /// </summary>
    public static void Set(HttpContext context, IDictionary<string, string> headers)
    {
        var filtered = headers
            .Where(h => h.Key.StartsWith("x-", StringComparison.OrdinalIgnoreCase))
            .ToDictionary(h => h.Key.ToLowerInvariant(), h => h.Value);
        context.Items[ItemsKey] = filtered;
    }

    /// <summary>
    /// Read the forwarded x-* headers for the current request via the supplied
    /// HttpContext (resolved through IHttpContextAccessor at outbound-call time).
    /// Returns an empty map when no headers were captured or no request is in scope.
    /// </summary>
    public static Dictionary<string, string> Get(HttpContext? context)
    {
        if (context?.Items.TryGetValue(ItemsKey, out var value) == true
            && value is IReadOnlyDictionary<string, string> headers)
        {
            return new Dictionary<string, string>(headers);
        }
        return new();
    }
}

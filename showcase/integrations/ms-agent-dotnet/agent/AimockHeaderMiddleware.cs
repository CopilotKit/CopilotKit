// STOPGAP: This integration-level header propagation replaces once copilotkit-sdk-dotnet
// ships (Microsoft contribution, ETA mid-2026). When that SDK lands, delete this code
// and use the SDK's built-in header propagation.
// See: https://www.notion.so/copilotkit/3543aa3818528150b6acc5b872ad7fe5

// TODO(copilotkit-sdk-dotnet): migrate to SDK-level header propagation
public class AimockHeaderMiddleware
{
    private readonly RequestDelegate _next;

    public AimockHeaderMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context)
    {
        var headers = context.Request.Headers
            .Where(h => h.Key.StartsWith("x-", StringComparison.OrdinalIgnoreCase))
            .ToDictionary(h => h.Key, h => h.Value.ToString());
        AimockHeaderContext.Set(headers);
        try
        {
            await _next(context);
        }
        finally
        {
            AimockHeaderContext.Set(new Dictionary<string, string>());
        }
    }
}

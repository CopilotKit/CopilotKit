// STOPGAP: This integration-level header propagation replaces once copilotkit-sdk-dotnet
// ships (Microsoft contribution, ETA mid-2026). When that SDK lands, delete this code
// and use the SDK's built-in header propagation.
// See: https://www.notion.so/copilotkit/3543aa3818528150b6acc5b872ad7fe5

// TODO(copilotkit-sdk-dotnet): migrate to SDK-level header propagation
public static class AimockHeaderContext
{
    private static readonly AsyncLocal<Dictionary<string, string>> _headers = new();

    public static void Set(Dictionary<string, string> headers)
    {
        var filtered = headers
            .Where(h => h.Key.StartsWith("x-", StringComparison.OrdinalIgnoreCase))
            .ToDictionary(h => h.Key.ToLowerInvariant(), h => h.Value);
        _headers.Value = filtered;
    }

    public static Dictionary<string, string> Get() => _headers.Value ?? new();
}

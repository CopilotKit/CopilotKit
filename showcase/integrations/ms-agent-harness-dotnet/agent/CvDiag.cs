// STOPGAP: Cross-language header-forwarding diagnostic ("CVDIAG") instrumentation.
// Emits a single-line, machine-greppable breadcrumb at the inbound capture
// boundary (AimockHeaderMiddleware) and the outbound-LLM boundary
// (AimockHeaderPolicy) so a request's x-aimock-context / x-diag-run-id /
// x-diag-hops correlation headers can be traced as they cross the AsyncLocal
// handoff. The line format is shared verbatim with the other language
// integrations (Java/TS/Python) so logs join on run_id.
//
// Instrumentation only: never alters request behavior. Full header values are
// never logged — only a 12-char prefix. Mirrors the Java CvDiag helper.
// TODO(copilotkit-sdk-dotnet): migrate to SDK-level header propagation

using Microsoft.Extensions.Logging;

public static class CvDiag
{
    public const string HeaderAimockContext = "x-aimock-context";
    public const string HeaderDiagRunId = "x-diag-run-id";
    public const string HeaderDiagHops = "x-diag-hops";
    public const string HeaderTestId = "x-test-id";

    // Seeded once at startup from Program.cs (where an ILoggerFactory exists).
    // The outbound boundary (AimockHeaderPolicy) is created statically without
    // DI access to a logger, so it reads this. Null-safe: if unset, outbound
    // logging is skipped (instrumentation must never throw).
    public static ILogger? Logger { get; set; }

    /// <summary>Logs the CVDIAG breadcrumb for the inbound capture boundary.</summary>
    public static void LogInbound(ILogger logger, string component, IReadOnlyDictionary<string, string> headers)
    {
        logger.LogInformation("{Line}", Line(component, "inbound", headers, "-", Status(headers)));
    }

    /// <summary>Logs the CVDIAG breadcrumb for the outbound-LLM boundary via the seeded static logger.</summary>
    public static void LogOutbound(string component, IReadOnlyDictionary<string, string> headers, int hop)
    {
        Logger?.LogInformation("{Line}", Line(component, "outbound-llm", headers, hop.ToString(), Status(headers)));
    }

    /// <summary>Returns the new x-diag-hops value after appending this layer's tag.</summary>
    public static string AppendHop(string? existingHops, string tag)
    {
        return string.IsNullOrWhiteSpace(existingHops) ? tag : existingHops + "," + tag;
    }

    /// <summary>Number of hops present on x-diag-hops after this layer appends.</summary>
    public static int HopCount(string? existingHops)
    {
        return string.IsNullOrWhiteSpace(existingHops) ? 1 : existingHops.Split(',').Length + 1;
    }

    private static string Status(IReadOnlyDictionary<string, string> headers)
        => Present(headers, HeaderAimockContext) ? "ok" : "miss";

    private static bool Present(IReadOnlyDictionary<string, string> headers, string key)
        => headers.TryGetValue(key, out var v) && !string.IsNullOrEmpty(v);

    private static string ValueOr(IReadOnlyDictionary<string, string> headers, string key, string fallback)
        => headers.TryGetValue(key, out var v) && !string.IsNullOrEmpty(v) ? v : fallback;

    private static string Prefix(IReadOnlyDictionary<string, string> headers, string key)
    {
        if (!headers.TryGetValue(key, out var v) || string.IsNullOrEmpty(v)) return "";
        return v.Length <= 12 ? v : v.Substring(0, 12);
    }

    private static string Line(string component, string boundary,
        IReadOnlyDictionary<string, string> headers, string hop, string status)
    {
        return "CVDIAG"
            + " component=" + component
            + " boundary=" + boundary
            + " run_id=" + ValueOr(headers, HeaderDiagRunId, "none")
            + " slug=" + ValueOr(headers, HeaderAimockContext, "MISSING")
            + " header_present=" + (Present(headers, HeaderAimockContext) ? "true" : "false")
            + " header_value_prefix=" + Prefix(headers, HeaderAimockContext)
            + " hop=" + hop
            + " status=" + status
            + " test_id=" + ValueOr(headers, HeaderTestId, "none")
            + " error=";
    }
}

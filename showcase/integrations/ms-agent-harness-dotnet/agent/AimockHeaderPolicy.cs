// STOPGAP: This integration-level header propagation replaces once copilotkit-sdk-dotnet
// ships (Microsoft contribution, ETA mid-2026). When that SDK lands, delete this code
// and use the SDK's built-in header propagation.
// See: https://www.notion.so/copilotkit/3543aa3818528150b6acc5b872ad7fe5

using System.ClientModel.Primitives;
using Microsoft.AspNetCore.Http;
using OpenAI;

// TODO(copilotkit-sdk-dotnet): migrate to SDK-level header propagation
public class AimockHeaderPolicy : PipelinePolicy
{
    // Seeded once at startup from Program.cs (where the DI container exists).
    // The policy is created statically via CreateOpenAIClientOptions at
    // agent-factory construction time and has no DI access, so it reads the
    // request's HttpContext through this seeded singleton accessor — mirroring
    // the CvDiag.Logger static-seed pattern. IHttpContextAccessor is a singleton
    // that resolves the *current* request's HttpContext via a holder the server
    // seeds at request entry; that holder flows across the AG-UI SSE-pump
    // ExecutionContext boundary, so the headers the middleware stashed on
    // HttpContext.Items are visible here at outbound-call time.
    public static IHttpContextAccessor? HttpContextAccessor { get; set; }

    public override void Process(PipelineMessage message, IReadOnlyList<PipelinePolicy> pipeline, int currentIndex)
    {
        ApplyHeadersAndDiag(message);
        ProcessNext(message, pipeline, currentIndex);
    }

    public override async ValueTask ProcessAsync(PipelineMessage message, IReadOnlyList<PipelinePolicy> pipeline, int currentIndex)
    {
        ApplyHeadersAndDiag(message);
        await ProcessNextAsync(message, pipeline, currentIndex);
    }

    // Forwards the captured x-* headers onto the outbound LLM request and emits
    // the CVDIAG outbound breadcrumb. The headers are read from the current
    // request's HttpContext.Items via IHttpContextAccessor — HttpContext flows
    // across the AG-UI SSE-pump ExecutionContext boundary, so the value the
    // middleware stashed is still visible here at outbound-call time. This layer
    // appends its hop tag to x-diag-hops on the outbound call.
    private static void ApplyHeadersAndDiag(PipelineMessage message)
    {
        var headers = AimockHeaderContext.Get(HttpContextAccessor?.HttpContext);
        foreach (var header in headers)
        {
            if (string.Equals(header.Key, CvDiag.HeaderDiagHops, StringComparison.OrdinalIgnoreCase))
                continue; // set below with this layer's hop appended
            // Add-if-absent: preserve correlation IDs and any headers set by prior policies/SDK.
            if (!message.Request.Headers.TryGetValue(header.Key, out _))
                message.Request.Headers.Set(header.Key, header.Value);
        }
        // GATING RULE: only deviate from original control flow (append the
        // x-diag-hops breadcrumb, emit the per-outbound CVDIAG log) when a
        // diagnostic header is actually present. On non-diagnostic traffic the
        // outbound request stays byte-identical to pre-instrumentation behavior
        // (the inbound x-* forward loop above is original behavior).
        bool diagnosticPresent = headers.ContainsKey(CvDiag.HeaderDiagRunId)
                || headers.ContainsKey(CvDiag.HeaderAimockContext);
        if (diagnosticPresent)
        {
            headers.TryGetValue(CvDiag.HeaderDiagHops, out var existingHops);
            message.Request.Headers.Set(CvDiag.HeaderDiagHops, CvDiag.AppendHop(existingHops, "backend-ms-agent-harness-dotnet"));
            CvDiag.LogOutbound("backend-ms-agent-harness-dotnet", headers, CvDiag.HopCount(existingHops));
        }
    }

    /// <summary>
    /// Creates an <see cref="OpenAIClientOptions"/> with the header forwarding policy
    /// pre-configured. All OpenAI client instantiations should use this to ensure
    /// x-* prefixed headers propagate to outgoing calls.
    /// </summary>
    // TODO(copilotkit-sdk-dotnet): migrate to SDK-level header propagation
    public static OpenAIClientOptions CreateOpenAIClientOptions(string endpoint)
    {
        var options = new OpenAIClientOptions
        {
            Endpoint = new Uri(endpoint),
        };
        options.AddPolicy(new AimockHeaderPolicy(), PipelinePosition.PerCall);
        return options;
    }
}

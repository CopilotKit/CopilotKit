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
        var (backend, ctx, provider, model) = CvdiagLlmContext(message);
        backend?.EmitLlmCallStart(ctx!, provider, model, EstimatePromptTokens(message));
        var sw = System.Diagnostics.Stopwatch.StartNew();
        string? errorClass = null;
        try
        {
            ProcessNext(message, pipeline, currentIndex);
        }
        catch (Exception ex)
        {
            errorClass = ex.GetType().Name;
            throw;
        }
        finally
        {
            sw.Stop();
            backend?.EmitLlmCallResponse(ctx!, provider, model, null, sw.ElapsedMilliseconds, errorClass);
        }
    }

    public override async ValueTask ProcessAsync(PipelineMessage message, IReadOnlyList<PipelinePolicy> pipeline, int currentIndex)
    {
        ApplyHeadersAndDiag(message);
        var (backend, ctx, provider, model) = CvdiagLlmContext(message);
        backend?.EmitLlmCallStart(ctx!, provider, model, EstimatePromptTokens(message));
        var sw = System.Diagnostics.Stopwatch.StartNew();
        string? errorClass = null;
        // Heartbeat: emit backend.llm.call.heartbeat every 10s while the outbound
        // call is outstanding (spec §3; verbose-tier-and-above). The loop is a
        // no-op when CVDIAG is off (backend null) — we skip starting it entirely.
        using var heartbeatCts = new CancellationTokenSource();
        Task? heartbeat = backend is null ? null : HeartbeatLoop(backend, ctx!, sw, heartbeatCts.Token);
        try
        {
            await ProcessNextAsync(message, pipeline, currentIndex);
        }
        catch (Exception ex)
        {
            errorClass = ex.GetType().Name;
            throw;
        }
        finally
        {
            sw.Stop();
            heartbeatCts.Cancel();
            if (heartbeat is not null)
            {
                try { await heartbeat; } catch (OperationCanceledException) { /* expected */ }
            }
            backend?.EmitLlmCallResponse(ctx!, provider, model, null, sw.ElapsedMilliseconds, errorClass);
        }
    }

    private static async Task HeartbeatLoop(CvdiagBackend backend, CvdiagBackend.RequestContext ctx,
        System.Diagnostics.Stopwatch sw, CancellationToken token)
    {
        try
        {
            while (!token.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(10), token);
                backend.EmitLlmCallHeartbeat(ctx, sw.ElapsedMilliseconds);
            }
        }
        catch (OperationCanceledException)
        {
            // Outbound call completed; stop heartbeating.
        }
    }

    // Resolve the CVDIAG backend + per-request context + outbound provider/model
    // at LLM-call time. Returns a null backend when CVDIAG is off so callers
    // skip every emit. The request context flows on the request async tree
    // (AsyncLocal), seeded by CvdiagInstrumentationMiddleware at ingress.
    private static (CvdiagBackend? Backend, CvdiagBackend.RequestContext? Ctx, string Provider, string Model)
        CvdiagLlmContext(PipelineMessage message)
    {
        var backend = CvdiagBackend.Instance;
        if (backend is null || !backend.IsEnabled) return (null, null, "openai", "unknown");
        var ctx = CvdiagBackend.CurrentRequestContext;
        if (ctx is null) return (null, null, "openai", "unknown");
        var host = message.Request.Uri?.Host ?? "";
        var provider = host.Contains("openai", StringComparison.OrdinalIgnoreCase) ? "openai"
            : host.Contains("azure", StringComparison.OrdinalIgnoreCase) ? "azure"
            : "openai";
        var model = ExtractModel(message) ?? "unknown";
        return (backend, ctx, provider, model);
    }

    // Best-effort: pull "model":"..." out of the outbound chat-completions body
    // without fully parsing it (the body is a BinaryContent we must not consume).
    private static string? ExtractModel(PipelineMessage message)
    {
        try
        {
            var content = message.Request.Content;
            if (content is null) return null;
            using var ms = new MemoryStream();
            content.WriteTo(ms, default);
            var json = System.Text.Encoding.UTF8.GetString(ms.ToArray());
            var marker = "\"model\":\"";
            var i = json.IndexOf(marker, StringComparison.Ordinal);
            if (i < 0) return null;
            var start = i + marker.Length;
            var end = json.IndexOf('"', start);
            return end > start ? json[start..end] : null;
        }
        catch
        {
            return null;
        }
    }

    // Rough prompt-token estimate (~4 chars/token) over the outbound body size.
    private static int EstimatePromptTokens(PipelineMessage message)
    {
        try
        {
            var content = message.Request.Content;
            if (content is null) return 0;
            using var ms = new MemoryStream();
            content.WriteTo(ms, default);
            return (int)(ms.Length / 4);
        }
        catch
        {
            return 0;
        }
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

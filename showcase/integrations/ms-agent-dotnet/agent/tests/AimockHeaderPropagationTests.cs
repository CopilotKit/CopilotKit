using System.ClientModel.Primitives;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace MsAgentDotnet.AgentTests;

// Red-green regression test for the .NET header-forwarding root cause.
//
// The bug: AimockHeaderMiddleware set the inbound x-aimock-context header into
// an AsyncLocal, then `await _next(context)` pumped the AG-UI SSE response on an
// ExecutionContext branch that did NOT inherit that AsyncLocal value. So when
// the outbound OpenAI call was made (deep inside the SSE pump), the policy read
// an empty header set -> x-aimock-context was NOT forwarded -> aimock strict
// mode returned 503 -> hung/aborted turns.
//
// The fix: stash the headers on HttpContext.Items and read them via
// IHttpContextAccessor. HttpContext flows across the SSE-pump ExecutionContext
// boundary (the server seeds the accessor's holder at request entry, before any
// middleware, and every branch of the request's async tree shares that holder).
//
// These tests reproduce the ExecutionContext boundary the SSE pump crosses:
// capture an ExecutionContext snapshot at "response start" and run the outbound
// read inside that captured context via ExecutionContext.Run, exactly as the
// SSE pump does. The AsyncLocal-set-after-capture value is invisible there; the
// HttpContext.Items value (read through the accessor singleton) survives.
public class AimockHeaderPropagationTests
{
    private const string AimockHeader = "x-aimock-context";
    private const string Slug = "gen-ui-chat";

    // Demonstrates the ROOT CAUSE: an AsyncLocal set AFTER an ExecutionContext
    // snapshot is captured is NOT visible when that snapshot is later run. This
    // is precisely the AG-UI SSE-pump boundary the old middleware lost the
    // header across. (RED for the old design.)
    [Fact]
    public void AsyncLocalSetAfterSnapshot_IsInvisibleAcrossExecutionContextBoundary()
    {
        var asyncLocal = new AsyncLocal<string?>();

        // SSE pump captures the ambient ExecutionContext at response-start,
        // BEFORE the middleware sets its AsyncLocal for this request.
        var capturedAtResponseStart = ExecutionContext.Capture()!;

        // Middleware sets the header into the AsyncLocal (old design).
        asyncLocal.Value = Slug;

        // Outbound LLM call runs inside the captured (pre-set) context.
        string? observedAtOutbound = "SENTINEL";
        ExecutionContext.Run(capturedAtResponseStart, _ =>
        {
            observedAtOutbound = asyncLocal.Value;
        }, null);

        // The header is LOST -> this is the 503-causing bug.
        Assert.Null(observedAtOutbound);
    }

    // Demonstrates the FIX: HttpContext.Items read via IHttpContextAccessor
    // survives the same ExecutionContext boundary, because the accessor's holder
    // (seeded once, ambient) points at the same mutable HttpContext regardless
    // of which captured ExecutionContext snapshot the outbound read runs on.
    // (GREEN for the new design.)
    [Fact]
    public void HttpContextItems_SurvivesExecutionContextBoundary_ViaAccessor()
    {
        var accessor = new HttpContextAccessor();
        var httpContext = new DefaultHttpContext();
        accessor.HttpContext = httpContext;

        // SSE pump captures the ambient ExecutionContext at response-start,
        // BEFORE the middleware stashes the header on HttpContext.Items.
        var capturedAtResponseStart = ExecutionContext.Capture()!;

        // Middleware stashes the inbound x-* headers on HttpContext.Items (fix).
        var inbound = new Dictionary<string, string> { [AimockHeader] = Slug };
        AimockHeaderContext.Set(httpContext, inbound);

        // Outbound LLM call runs inside the captured (pre-set) context, reading
        // through the accessor exactly as AimockHeaderPolicy.ApplyHeadersAndDiag does.
        Dictionary<string, string> observedAtOutbound = new();
        ExecutionContext.Run(capturedAtResponseStart, _ =>
        {
            observedAtOutbound = AimockHeaderContext.Get(accessor.HttpContext);
        }, null);

        // The header is PRESENT at the outbound boundary -> forwarded -> 200.
        Assert.True(observedAtOutbound.ContainsKey(AimockHeader));
        Assert.Equal(Slug, observedAtOutbound[AimockHeader]);
    }

    // End-to-end through the actual policy: the seeded static accessor lets the
    // production policy forward x-aimock-context onto a real outbound request
    // message, even when the policy runs inside a pre-captured ExecutionContext.
    [Fact]
    public async Task Policy_ForwardsAimockContext_OntoOutboundRequest_AcrossBoundary()
    {
        var accessor = new HttpContextAccessor();
        var httpContext = new DefaultHttpContext();
        accessor.HttpContext = httpContext;
        AimockHeaderPolicy.HttpContextAccessor = accessor;

        // SSE pump captures context BEFORE the header is stashed.
        var capturedAtResponseStart = ExecutionContext.Capture()!;

        AimockHeaderContext.Set(httpContext, new Dictionary<string, string> { [AimockHeader] = Slug });

        // Build a real outbound pipeline message and run it through the policy
        // inside the captured context (mimicking the SSE-pump outbound call).
        var policy = new AimockHeaderPolicy();
        var pipeline = ClientPipeline.Create();
        using var message = pipeline.CreateMessage();
        message.Request.Method = "POST";
        message.Request.Uri = new Uri("http://localhost:1/v1/chat/completions");

        // The header policy at index 0, followed by a terminal no-op so
        // ProcessNext has a successor to hand off to (and we never make a real
        // network call).
        var policies = new PipelinePolicy[] { policy, new TerminalPolicy() };

        var tcs = new TaskCompletionSource();
        ExecutionContext.Run(capturedAtResponseStart, _ =>
        {
            policy.Process(message, policies, 0);
            tcs.SetResult();
        }, null);
        await tcs.Task;

        Assert.True(message.Request.Headers.TryGetValue(AimockHeader, out var forwarded));
        Assert.Equal(Slug, forwarded);
    }

    // Terminal pipeline policy: does nothing (does not call ProcessNext), so the
    // policy chain stops here without making a real network request.
    private sealed class TerminalPolicy : PipelinePolicy
    {
        public override void Process(PipelineMessage message, IReadOnlyList<PipelinePolicy> pipeline, int currentIndex)
        {
        }

        public override ValueTask ProcessAsync(PipelineMessage message, IReadOnlyList<PipelinePolicy> pipeline, int currentIndex)
            => ValueTask.CompletedTask;
    }
}

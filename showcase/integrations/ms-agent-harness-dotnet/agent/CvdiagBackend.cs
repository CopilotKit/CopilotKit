// CvdiagBackend.cs — backend-layer CVDIAG instrumentation for ms-agent-dotnet
// (plan unit L1-F; spec §3 backend boundaries + §6 tier matrix). Wires the 11
// backend boundaries through the shared CvdiagEmitter (source-included from
// _shared/dotnet/) so this integration emits the same flap-observability
// envelope as the Python / TS / Java backends.
//
// The 11 backend boundaries (spec §3):
//   backend.request.ingress     — HTTP request received (AimockHeaderMiddleware)
//   backend.agent.enter         — agent loop entered (request scope, pre-pump)
//   backend.llm.call.start      — outbound LLM call dispatched (AimockHeaderPolicy)
//   backend.llm.call.heartbeat  — every 10s while an LLM call is outstanding
//   backend.llm.call.response   — LLM response received (policy, post-pipeline)
//   backend.sse.first_byte      — first byte written to the response stream
//   backend.sse.event           — every SSE event written (debug tier only)
//   backend.sse.aborted         — stream terminated abnormally
//   backend.agent.exit          — agent loop exited (request scope, post-pump)
//   backend.response.complete   — response finished (status, bytes, duration)
//   backend.error.caught        — exception caught in the request pipeline
//
// FAIL-CLOSED / OFF BY DEFAULT: the whole layer is gated by the
// CVDIAG_BACKEND_EMITTER env (default "off"). When off, IsEnabled is false and
// every Emit* method is a no-op — zero behavioral change on the request path.
// Pure instrumentation: a CVDIAG failure must NEVER throw into the observed
// boundary (the shared CvdiagEmitter swallows hot-path errors to stderr).

using System.Diagnostics;
using Copilotkit.Showcase.Cvdiag;
using Microsoft.AspNetCore.Http;

// TODO(copilotkit-sdk-dotnet): fold into SDK-level observability when it ships.
public sealed class CvdiagBackend
{
    private const string SlugHeader = "x-aimock-context";
    private const string TestIdHeader = "x-test-id";
    public const string EnabledEnv = "CVDIAG_BACKEND_EMITTER";

    // Seeded once at startup from Program.cs (mirrors the CvDiag.Logger /
    // AimockHeaderPolicy.HttpContextAccessor static-seed pattern). The outbound
    // policy is created without DI, so it reads this static singleton.
    public static CvdiagBackend? Instance { get; set; }

    private readonly CvdiagEmitter? _emitter;

    /// <summary>True iff CVDIAG_BACKEND_EMITTER is "on" (default off → null emitter).</summary>
    public bool IsEnabled => _emitter is not null;

    public CvdiagBackend(IReadOnlyDictionary<string, string?>? env = null)
    {
        env ??= ReadProcessEnv();
        var flag = env.GetValueOrDefault(EnabledEnv);
        if (!string.Equals(flag, "on", StringComparison.OrdinalIgnoreCase))
        {
            _emitter = null; // OFF by default → no-op layer.
            return;
        }
        var pbWriteUrl = env.GetValueOrDefault("CVDIAG_PB_WRITE_URL");
        _emitter = new CvdiagEmitter(new CvdiagEmitterOptions
        {
            Layer = CvdiagLayer.Backend,
            Env = env,
            PbWriteUrl = string.IsNullOrEmpty(pbWriteUrl) ? null : pbWriteUrl,
        });
    }

    // ── Per-request correlation context ──────────────────────────────────────
    //
    // Resolved once at ingress from the forwarded x-* headers (slug from
    // x-aimock-context, test_id from x-test-id) and stashed on HttpContext.Items
    // so the later boundaries (sse.*, response.complete, llm.call.*) reuse the
    // same trace.

    private const string CtxKey = "__cvdiag_backend_ctx__";

    // Current-request context for the outbound-LLM boundary. The instrumentation
    // middleware sets this at ingress; the LLM policy (which has no HttpContext
    // in this integration's wiring) reads it. It flows on the request's async
    // tree the same way AimockHeaderContext's headers do.
    private static readonly AsyncLocal<RequestContext?> CurrentContext = new();

    public sealed class RequestContext
    {
        public required string Slug { get; init; }
        public required string Demo { get; init; }
        public required string TestId { get; init; }
        public long IngressMs { get; init; }
        public int SseEventCount;
        public bool FirstByteSeen;
    }

    /// <summary>
    /// Resolve (or create) the per-request CVDIAG context from the forwarded
    /// headers on the HttpContext. Slug ← x-aimock-context, demo ← request path,
    /// test_id ← x-test-id (minted if absent so the trace is always well-formed).
    /// Reading headers directly off HttpContext (rather than the integration's
    /// AimockHeaderContext) keeps this identical across both .NET integrations.
    /// </summary>
    public RequestContext GetOrCreateContext(HttpContext context)
    {
        if (context.Items.TryGetValue(CtxKey, out var existing) && existing is RequestContext rc)
        {
            return rc;
        }
        var slug = HeaderValue(context, SlugHeader) ?? "unknown";
        var testId = HeaderValue(context, TestIdHeader) ?? CvdiagEmitter.MintTestId();
        var demo = context.Request.Path.HasValue
            ? context.Request.Path.Value!.Trim('/').Split('/').FirstOrDefault() ?? "default"
            : "default";
        if (string.IsNullOrEmpty(demo)) demo = "default";
        var created = new RequestContext
        {
            Slug = slug,
            Demo = demo,
            TestId = testId,
            IngressMs = NowMs(),
        };
        context.Items[CtxKey] = created;
        CurrentContext.Value = created;
        return created;
    }

    private static string? HeaderValue(HttpContext context, string name)
        => context.Request.Headers.TryGetValue(name, out var v) && !string.IsNullOrEmpty(v.ToString())
            ? v.ToString()
            : null;

    /// <summary>The current request's context for the outbound-LLM boundary.</summary>
    public static RequestContext? CurrentRequestContext => CurrentContext.Value;

    // ── The 11 backend boundaries ────────────────────────────────────────────

    public void EmitRequestIngress(RequestContext ctx, HttpContext http)
    {
        if (_emitter is null) return;
        _emitter.Emit(new CvdiagEmitArgs
        {
            Layer = CvdiagLayer.Backend,
            Boundary = CvdiagBoundary.BackendRequestIngress,
            Slug = ctx.Slug,
            Demo = ctx.Demo,
            Outcome = CvdiagOutcome.Info,
            TestId = ctx.TestId,
            EdgeHeaders = ExtractEdgeHeaders(http),
            Metadata = new Dictionary<string, object?>
            {
                ["method"] = http.Request.Method,
                ["path"] = http.Request.Path.Value ?? "",
                ["content_length"] = (int?)http.Request.ContentLength,
            },
        });
    }

    public void EmitAgentEnter(RequestContext ctx, string agentName, string modelId)
    {
        if (_emitter is null) return;
        _emitter.Emit(new CvdiagEmitArgs
        {
            Layer = CvdiagLayer.Backend,
            Boundary = CvdiagBoundary.BackendAgentEnter,
            Slug = ctx.Slug,
            Demo = ctx.Demo,
            Outcome = CvdiagOutcome.Info,
            TestId = ctx.TestId,
            Metadata = new Dictionary<string, object?>
            {
                ["agent_name"] = agentName,
                ["model_id"] = modelId,
            },
        });
    }

    public void EmitLlmCallStart(RequestContext ctx, string provider, string model, int promptTokenEstimate)
    {
        if (_emitter is null) return;
        _emitter.Emit(new CvdiagEmitArgs
        {
            Layer = CvdiagLayer.Backend,
            Boundary = CvdiagBoundary.BackendLlmCallStart,
            Slug = ctx.Slug,
            Demo = ctx.Demo,
            Outcome = CvdiagOutcome.Info,
            TestId = ctx.TestId,
            Metadata = new Dictionary<string, object?>
            {
                ["provider"] = provider,
                ["model"] = model,
                ["prompt_token_count_estimate"] = promptTokenEstimate,
            },
        });
    }

    public void EmitLlmCallHeartbeat(RequestContext ctx, long elapsedMsSinceStart)
    {
        if (_emitter is null) return;
        _emitter.Emit(new CvdiagEmitArgs
        {
            Layer = CvdiagLayer.Backend,
            Boundary = CvdiagBoundary.BackendLlmCallHeartbeat,
            Slug = ctx.Slug,
            Demo = ctx.Demo,
            Outcome = CvdiagOutcome.Info,
            TestId = ctx.TestId,
            Metadata = new Dictionary<string, object?>
            {
                ["elapsed_ms_since_start"] = elapsedMsSinceStart,
            },
        });
    }

    public void EmitLlmCallResponse(RequestContext ctx, string provider, string model,
        int? responseTokenCount, long latencyMs, string? errorClass)
    {
        if (_emitter is null) return;
        _emitter.Emit(new CvdiagEmitArgs
        {
            Layer = CvdiagLayer.Backend,
            Boundary = CvdiagBoundary.BackendLlmCallResponse,
            Slug = ctx.Slug,
            Demo = ctx.Demo,
            Outcome = errorClass is null ? CvdiagOutcome.Ok : CvdiagOutcome.Err,
            TestId = ctx.TestId,
            DurationMs = latencyMs,
            Metadata = new Dictionary<string, object?>
            {
                ["provider"] = provider,
                ["model"] = model,
                ["response_token_count"] = responseTokenCount,
                ["latency_ms"] = (int)latencyMs,
                ["error_class"] = errorClass,
            },
        });
    }

    public void EmitSseFirstByte(RequestContext ctx, long deltaMsFromIngress)
    {
        if (_emitter is null) return;
        _emitter.Emit(new CvdiagEmitArgs
        {
            Layer = CvdiagLayer.Backend,
            Boundary = CvdiagBoundary.BackendSseFirstByte,
            Slug = ctx.Slug,
            Demo = ctx.Demo,
            Outcome = CvdiagOutcome.Info,
            TestId = ctx.TestId,
            Metadata = new Dictionary<string, object?>
            {
                ["delta_ms_from_ingress"] = deltaMsFromIngress,
            },
        });
    }

    public void EmitSseEvent(RequestContext ctx, string eventType, int payloadSizeBytes, int sequenceNum)
    {
        if (_emitter is null) return;
        _emitter.Emit(new CvdiagEmitArgs
        {
            Layer = CvdiagLayer.Backend,
            Boundary = CvdiagBoundary.BackendSseEvent,
            Slug = ctx.Slug,
            Demo = ctx.Demo,
            Outcome = CvdiagOutcome.Info,
            TestId = ctx.TestId,
            Metadata = new Dictionary<string, object?>
            {
                ["event_type"] = eventType,
                ["payload_size_bytes"] = payloadSizeBytes,
                ["sequence_num"] = sequenceNum,
            },
        });
    }

    public void EmitSseAborted(RequestContext ctx, string terminationKind, int bytesBeforeAbort)
    {
        if (_emitter is null) return;
        _emitter.Emit(new CvdiagEmitArgs
        {
            Layer = CvdiagLayer.Backend,
            Boundary = CvdiagBoundary.BackendSseAborted,
            Slug = ctx.Slug,
            Demo = ctx.Demo,
            Outcome = CvdiagOutcome.Err,
            TestId = ctx.TestId,
            Metadata = new Dictionary<string, object?>
            {
                ["termination_kind"] = terminationKind,
                ["bytes_before_abort"] = bytesBeforeAbort,
            },
        });
    }

    public void EmitAgentExit(RequestContext ctx, string terminalOutcome, long totalDurationMs)
    {
        if (_emitter is null) return;
        _emitter.Emit(new CvdiagEmitArgs
        {
            Layer = CvdiagLayer.Backend,
            Boundary = CvdiagBoundary.BackendAgentExit,
            Slug = ctx.Slug,
            Demo = ctx.Demo,
            Outcome = terminalOutcome == "ok" ? CvdiagOutcome.Ok : CvdiagOutcome.Err,
            TestId = ctx.TestId,
            DurationMs = totalDurationMs,
            Metadata = new Dictionary<string, object?>
            {
                ["terminal_outcome"] = terminalOutcome,
                ["total_duration_ms"] = totalDurationMs,
            },
        });
    }

    public void EmitResponseComplete(RequestContext ctx, int httpStatus, int contentLength,
        long totalDurationMs, int sseEventCount)
    {
        if (_emitter is null) return;
        _emitter.Emit(new CvdiagEmitArgs
        {
            Layer = CvdiagLayer.Backend,
            Boundary = CvdiagBoundary.BackendResponseComplete,
            Slug = ctx.Slug,
            Demo = ctx.Demo,
            Outcome = httpStatus is >= 200 and < 400 ? CvdiagOutcome.Ok : CvdiagOutcome.Err,
            TestId = ctx.TestId,
            DurationMs = totalDurationMs,
            Metadata = new Dictionary<string, object?>
            {
                ["http_status"] = httpStatus,
                ["content_length"] = contentLength,
                ["total_duration_ms"] = totalDurationMs,
                ["sse_event_count"] = sseEventCount,
            },
        });
    }

    public void EmitErrorCaught(RequestContext ctx, Exception ex)
    {
        if (_emitter is null) return;
        var (stackBrief, truncated) = StackBrief(ex);
        _emitter.Emit(new CvdiagEmitArgs
        {
            Layer = CvdiagLayer.Backend,
            Boundary = CvdiagBoundary.BackendErrorCaught,
            Slug = ctx.Slug,
            Demo = ctx.Demo,
            Outcome = CvdiagOutcome.Err,
            TestId = ctx.TestId,
            Metadata = new Dictionary<string, object?>
            {
                ["exception_type"] = ex.GetType().FullName ?? ex.GetType().Name,
                ["message_scrubbed"] = Scrub(ex.Message),
                ["stack_brief"] = stackBrief,
                ["truncated"] = truncated,
            },
        });
    }

    // ── PII scrub (spec §10 / R6-F3) ─────────────────────────────────────────
    //
    // Redact secret-shaped tokens from any free-text we put on the wire
    // (exception messages, etc.). Mirrors the probe/Python scrub: Bearer
    // tokens, OpenAI-style sk-/sk-test- keys, and Authorization header values.
    // Capped at 512 bytes per spec backend.error.caught message_scrubbed.

    private static readonly System.Text.RegularExpressions.Regex[] ScrubPatterns =
    {
        new(@"(?i)bearer\s+[A-Za-z0-9._\-]+", System.Text.RegularExpressions.RegexOptions.Compiled),
        new(@"sk-[A-Za-z0-9._\-]{8,}", System.Text.RegularExpressions.RegexOptions.Compiled),
        new(@"(?i)authorization\s*[:=]\s*\S+", System.Text.RegularExpressions.RegexOptions.Compiled),
    };

    // URL userinfo authority segment — redact the credentials between
    // `scheme://` and the LAST authority `@`, keeping the scheme and host.
    // Mirrors scrubSecrets' URL_USERINFO_REGEX (harness/src/cvdiag/scrub.ts):
    // covers `scheme://user:pass@host`, the colon-less `scheme://token@host`
    // (e.g. `https://ghp_xxx@host`), and multi-`@` authorities. The userinfo
    // class `[^/\s?#]*` excludes `?`/`#`/`/`/whitespace so the match can never
    // cross into the path/query/fragment (R5-A2). Replacement: `$1[REDACTED]@`.
    private static readonly System.Text.RegularExpressions.Regex UrlUserinfoPattern =
        new(@"([a-z][a-z0-9+.\-]*://)[^/\s?#]*@",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.Compiled);

    /// <summary>Redact secret-shaped tokens and cap to 512 bytes (spec backend.error.caught).</summary>
    public static string Scrub(string? raw)
    {
        if (string.IsNullOrEmpty(raw)) return "";
        var scrubbed = raw;
        foreach (var pat in ScrubPatterns)
        {
            scrubbed = pat.Replace(scrubbed, "[REDACTED]");
        }
        scrubbed = UrlUserinfoPattern.Replace(scrubbed, "$1[REDACTED]@");
        if (System.Text.Encoding.UTF8.GetByteCount(scrubbed) > 512)
        {
            scrubbed = scrubbed.Length > 509 ? scrubbed[..509] + "..." : scrubbed;
        }
        return scrubbed;
    }

    // ≤8 frames, each "file:line", PII-scrubbed; flags truncation past 8 frames.
    private static (string Brief, bool Truncated) StackBrief(Exception ex)
    {
        var trace = new StackTrace(ex, fNeedFileInfo: true);
        var frames = trace.GetFrames();
        if (frames is null || frames.Length == 0)
        {
            return (Scrub(ex.StackTrace ?? ""), false);
        }
        var truncated = frames.Length > 8;
        var lines = frames.Take(8).Select(f =>
        {
            var file = f.GetFileName();
            var line = f.GetFileLineNumber();
            var method = f.GetMethod()?.Name ?? "?";
            return file is not null ? $"{file}:{line}" : method;
        });
        return (Scrub(string.Join(" <- ", lines)), truncated);
    }

    private static EdgeHeaders ExtractEdgeHeaders(HttpContext http)
    {
        var bag = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var (key, value) in http.Request.Headers)
        {
            bag[key] = value.ToString();
        }
        return CvdiagEmitter.FilterEdgeHeaders(bag);
    }

    public static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private static IReadOnlyDictionary<string, string?> ReadProcessEnv()
    {
        var dict = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (System.Collections.DictionaryEntry e in Environment.GetEnvironmentVariables())
        {
            if (e.Key is string k) dict[k] = e.Value as string;
        }
        return dict;
    }
}

// CvdiagInstrumentationMiddleware.cs — the request-pipeline CVDIAG boundaries
// for ms-agent-dotnet (plan unit L1-F; spec §3). Sits OUTSIDE MapAGUI (which
// owns the agent loop + SSE writing) and observes the request from the edge:
//
//   • backend.request.ingress    — at request entry (method/path/content-length)
//   • backend.agent.enter        — just before handing off to the pipeline
//   • backend.sse.first_byte     — first byte written to the response body
//   • backend.sse.event          — each "data:" SSE frame written (debug tier)
//   • backend.sse.aborted        — client/edge disconnect mid-stream
//   • backend.agent.exit         — after the pipeline returns
//   • backend.response.complete  — terminal status/bytes/duration/event-count
//   • backend.error.caught       — unhandled exception in the pipeline
//
// The remaining 3 boundaries (backend.llm.call.start/heartbeat/response) fire in
// AimockHeaderPolicy at the outbound-LLM boundary.
//
// OFF BY DEFAULT: when CvdiagBackend.IsEnabled is false the middleware degrades
// to a bare `await _next(context)` — byte-identical to pre-instrumentation
// behavior, no response-stream wrapping. Pure instrumentation: never alters the
// response, never throws into the pipeline beyond re-raising the original error.

using System.Text;
using Microsoft.AspNetCore.Http;

// TODO(copilotkit-sdk-dotnet): fold into SDK-level observability when it ships.
public sealed class CvdiagInstrumentationMiddleware
{
    private readonly RequestDelegate _next;

    public CvdiagInstrumentationMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var backend = CvdiagBackend.Instance;
        if (backend is null || !backend.IsEnabled)
        {
            await _next(context); // OFF: no wrapping, original behavior.
            return;
        }

        var ctx = backend.GetOrCreateContext(context);
        backend.EmitRequestIngress(ctx, context);
        // Agent name/model are not known at the edge; the agent loop lives inside
        // MapAGUI. We record the demo (= mount path) as the agent name and defer
        // precise model id to backend.llm.call.start (which has the real model).
        backend.EmitAgentEnter(ctx, ctx.Demo, "unknown");

        var originalBody = context.Response.Body;
        await using var tap = new SseTapStream(originalBody, backend, ctx);
        context.Response.Body = tap;

        var sw = System.Diagnostics.Stopwatch.StartNew();
        var terminalOutcome = "ok";
        try
        {
            await _next(context);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // Client/edge severed the connection mid-stream.
            terminalOutcome = "aborted";
            backend.EmitSseAborted(ctx, "client_disconnect", tap.BytesWritten);
            throw;
        }
        catch (Exception ex)
        {
            terminalOutcome = "error";
            backend.EmitErrorCaught(ctx, ex);
            throw;
        }
        finally
        {
            sw.Stop();
            context.Response.Body = originalBody;
            backend.EmitAgentExit(ctx, terminalOutcome, sw.ElapsedMilliseconds);
            backend.EmitResponseComplete(
                ctx,
                httpStatus: context.Response.StatusCode,
                contentLength: tap.BytesWritten,
                totalDurationMs: sw.ElapsedMilliseconds,
                sseEventCount: ctx.SseEventCount);
        }
    }

    // A pass-through write tap over the response body. It NEVER buffers or
    // mutates the bytes — it forwards every write verbatim and only counts
    // bytes, detects the first byte, and parses "data:" SSE frame boundaries to
    // emit backend.sse.first_byte / backend.sse.event. Counting/parsing failures
    // are swallowed so the response is never affected.
    private sealed class SseTapStream : Stream
    {
        private readonly Stream _inner;
        private readonly CvdiagBackend _backend;
        private readonly CvdiagBackend.RequestContext _ctx;
        private readonly StringBuilder _lineBuf = new();
        private int _seq;

        public int BytesWritten { get; private set; }

        public SseTapStream(Stream inner, CvdiagBackend backend, CvdiagBackend.RequestContext ctx)
        {
            _inner = inner;
            _backend = backend;
            _ctx = ctx;
        }

        private void Observe(ReadOnlySpan<byte> buffer)
        {
            try
            {
                if (buffer.IsEmpty) return;
                if (!_ctx.FirstByteSeen)
                {
                    _ctx.FirstByteSeen = true;
                    _backend.EmitSseFirstByte(_ctx, CvdiagBackend.NowMs() - _ctx.IngressMs);
                }
                BytesWritten += buffer.Length;
                ParseSseFrames(buffer);
            }
            catch
            {
                // Instrumentation must never disturb the response.
            }
        }

        // Accumulate text and emit a backend.sse.event per blank-line-delimited
        // SSE record that carries a `data:`/`event:` field. Size = bytes of the
        // record; NOT the content itself (spec: type+size, never content).
        private void ParseSseFrames(ReadOnlySpan<byte> buffer)
        {
            var text = Encoding.UTF8.GetString(buffer);
            foreach (var ch in text)
            {
                if (ch == '\n')
                {
                    var line = _lineBuf.ToString();
                    _lineBuf.Clear();
                    if (line.StartsWith("event:", StringComparison.Ordinal)
                        || line.StartsWith("data:", StringComparison.Ordinal))
                    {
                        var eventType = line.StartsWith("event:", StringComparison.Ordinal)
                            ? line[6..].Trim()
                            : "message";
                        _ctx.SseEventCount++;
                        _backend.EmitSseEvent(_ctx, eventType,
                            Encoding.UTF8.GetByteCount(line), _seq++);
                    }
                }
                else if (ch != '\r')
                {
                    _lineBuf.Append(ch);
                }
            }
        }

        public override void Write(byte[] buffer, int offset, int count)
        {
            Observe(buffer.AsSpan(offset, count));
            _inner.Write(buffer, offset, count);
        }

        public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer,
            CancellationToken cancellationToken = default)
        {
            Observe(buffer.Span);
            await _inner.WriteAsync(buffer, cancellationToken);
        }

        public override Task WriteAsync(byte[] buffer, int offset, int count,
            CancellationToken cancellationToken)
        {
            Observe(buffer.AsSpan(offset, count));
            return _inner.WriteAsync(buffer, offset, count, cancellationToken);
        }

        public override void Flush() => _inner.Flush();
        public override Task FlushAsync(CancellationToken cancellationToken)
            => _inner.FlushAsync(cancellationToken);

        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => _inner.Length;
        public override long Position
        {
            get => _inner.Position;
            set => _inner.Position = value;
        }
        public override int Read(byte[] buffer, int offset, int count)
            => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin)
            => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
    }
}

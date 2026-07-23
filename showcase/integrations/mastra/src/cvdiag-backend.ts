/**
 * cvdiag-backend.ts — CVDIAG backend-layer instrumentation wrapper (plan unit
 * L1-E) for this TS integration's CopilotKit route handler.
 *
 * `withCvdiagBackend(handler, opts)` wraps a Next.js / Web route handler
 * (`(req) => Promise<Response>`) and emits the 11 backend-layer CVDIAG
 * boundaries around it (spec §3 backend boundaries, §5 schema, §6 tiers):
 *
 *   backend.request.ingress    — on handler entry (method, path, content_length)
 *   backend.agent.enter        — agent_name + model_id resolved for the request
 *   backend.llm.call.start     — best-effort lifecycle marker before the handler
 *                                drives the LLM (verbose tier)
 *   backend.llm.call.heartbeat — periodic liveness ping while the handler runs
 *                                (verbose tier; 10s cadence, same as the Python
 *                                emitter's asyncio heartbeat)
 *   backend.llm.call.response  — after the handler resolves (verbose tier)
 *   backend.sse.first_byte     — first byte observed on the streamed body
 *   backend.sse.event          — per streamed chunk (debug tier), monotonic
 *                                sequence_num
 *   backend.sse.aborted        — stream errored / aborted mid-flight
 *   backend.agent.exit         — terminal outcome of the agent turn
 *   backend.response.complete  — http_status, content_length, duration, SSE count
 *   backend.error.caught       — handler threw (exception_type + scrubbed message)
 *
 * GUARDED BY `CVDIAG_BACKEND_EMITTER` (default OFF): unless the env var is set
 * truthy, the wrapper is a transparent pass-through with ZERO overhead — the
 * handler is returned unwrapped. CVDIAG is pure instrumentation: a failure in
 * this module must NEVER throw into the wrapped handler (every emit is
 * best-effort inside the emitter's own try/catch, and the body wrapper degrades
 * to passing chunks through verbatim on any internal error).
 *
 * The emitter is the co-located, build-context-staged copy under
 * `@/cvdiag/cvdiag-emitter` (staged by `bin/showcase cvdiag-stage-ts` — see
 * that command's header). A standalone integration build has no path alias back
 * to `showcase/harness`, so the canonical L0-A sources are copied into the
 * build context rather than imported across the monorepo.
 */

import {
  createCvdiagFetchPbWriterFromEnv,
  CvdiagEmitter,
  filterEdgeHeaders,
  mintTestId,
  scrubSecrets,
} from "@/cvdiag/cvdiag-emitter";
import type {
  CvdiagEnvelope,
  CvdiagOutcome,
  CvdiagPbWriter,
} from "@/cvdiag/cvdiag-emitter";

/**
 * Web-standard route handler shape. Generic over the request type so a Next.js
 * handler typed `(req: NextRequest) => Promise<Response>` wraps without a cast
 * (`NextRequest` is a structural subtype of `Request`).
 */
export type RouteHandler<Req extends Request = Request> = (
  req: Req,
) => Promise<Response>;

export interface WithCvdiagBackendOptions {
  /** Integration slug (e.g. "langgraph-typescript"). */
  slug: string;
  /**
   * Agent name to stamp on backend.agent.enter. Integrations without a named
   * per-request agent (e.g. claude-sdk-typescript's pass-through) pass a fixed
   * string.
   */
  agentName: string;
  /** Best-effort model identifier for backend.agent.enter / llm.call.*. */
  modelId?: string;
  /** Provider label for backend.llm.call.* (defaults to "unknown"). */
  provider?: string;
  /** Heartbeat cadence in ms (default 10_000, matching the Python emitter). */
  heartbeatMs?: number;
  /** Injectable emitter (tests); defaults to a process-env-configured one. */
  emitter?: CvdiagEmitter;
}

/** Env flag that gates the wrapper. Default OFF. */
const ENABLE_ENV = "CVDIAG_BACKEND_EMITTER";

/** Truthy check for the gate (1 / true / yes / on, case-insensitive). */
function isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[ENABLE_ENV];
  if (raw === undefined) return false;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

/** Extract the request path from a Request URL, falling back to the raw URL. */
function requestPath(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return req.url;
  }
}

/** Parse a Content-Length header to a number or null. */
function contentLength(headers: Headers): number | null {
  const raw = headers.get("content-length");
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read the inbound probe `x-test-id` — the CROSS-LAYER JOIN KEY (spec §5). The
 * probe mints a per-run id (`d4-/d6-<slug>-<runId>`) and prefix-forwards it on
 * every request; the backend MUST adopt it as the envelope `test_id` so its
 * rows JOIN the probe's rows. Returns the trimmed header value, or undefined
 * when absent/blank (→ the emitter mints a fresh UUIDv7). The emitter
 * sanitizes/validates the value, so we forward it as-is here.
 */
function inboundTestId(headers: Headers): string | undefined {
  try {
    const raw = headers.get("x-test-id");
    if (raw === null) return undefined;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

/** Snapshot the allow-listed edge headers off a header bag. */
function edgeHeadersFrom(
  headers: Headers,
): ReturnType<typeof filterEdgeHeaders> {
  const bag: Record<string, string | null> = {};
  headers.forEach((value, key) => {
    bag[key] = value;
  });
  return filterEdgeHeaders(bag);
}

/**
 * Wrap a route handler with CVDIAG backend instrumentation. When
 * `CVDIAG_BACKEND_EMITTER` is not truthy, returns the handler unwrapped (no
 * overhead). The wrapped handler emits the 11 backend boundaries and is
 * crash-proof: any internal CVDIAG error degrades to the original behavior.
 */
export function withCvdiagBackend<Req extends Request>(
  handler: RouteHandler<Req>,
  opts: WithCvdiagBackendOptions,
): RouteHandler<Req> {
  if (opts.emitter === undefined && !isEnabled()) {
    // Gate OFF: transparent pass-through.
    return handler;
  }

  const provider = opts.provider ?? "unknown";
  const modelId = opts.modelId ?? "unknown";
  const heartbeatMs = opts.heartbeatMs ?? 10_000;

  // Construct the concrete writer-role PB writer ONCE (env is read once at
  // wrapper setup). Returns undefined when CVDIAG_PB_URL is unset — in which
  // case the emitter is left writer-less (current stdout-only behavior). This
  // is the fix for the type-only-seam defect: without an injected pbWriter the
  // emitter's flush was a permanent no-op and ZERO backend events persisted.
  // A test-injected emitter (opts.emitter) brings its own writer seam.
  const pbWriter: CvdiagPbWriter | undefined =
    opts.emitter !== undefined ? undefined : createCvdiagFetchPbWriterFromEnv();

  return async (req: Req): Promise<Response> => {
    const emitter =
      opts.emitter ??
      new CvdiagEmitter({ layer: "backend", autoFlush: true, pbWriter });
    // CROSS-LAYER JOIN (spec §5): adopt the inbound probe `x-test-id` as the
    // envelope `test_id` so backend rows join the probe's rows on the SAME run
    // key. When the header is absent, the emitter mints a fresh UUIDv7. The
    // backend's OWN per-request id is a freshly minted UUIDv7 passed as
    // `traceId` — kept DISTINCT from an adopted (non-UUIDv7) `test_id` so
    // trace/span stay per-request (NOT the shared run id).
    const testId = inboundTestId(req.headers);
    const traceId = mintTestId();
    const startedAt = Date.now();
    const path = requestPath(req);
    const edgeHeaders = safeEdgeHeaders(req);

    const baseEmit = (
      boundary: Parameters<CvdiagEmitter["emit"]>[0]["boundary"],
      outcome: CvdiagOutcome,
      metadata: Record<string, unknown>,
      durationMs: number | null = null,
    ): CvdiagEnvelope | null =>
      emitter.emit({
        layer: "backend",
        boundary,
        slug: opts.slug,
        demo: opts.slug,
        outcome,
        testId,
        traceId,
        edgeHeaders,
        metadata,
        durationMs,
      });

    // 1) backend.request.ingress
    baseEmit("backend.request.ingress", "info", {
      method: req.method,
      path,
      content_length: contentLength(req.headers),
    });

    // 2) backend.agent.enter
    baseEmit("backend.agent.enter", "info", {
      agent_name: opts.agentName,
      model_id: modelId,
    });

    // 3) backend.llm.call.start (verbose)
    baseEmit("backend.llm.call.start", "info", {
      provider,
      model: modelId,
      prompt_token_count_estimate: 0,
    });

    // 4) backend.llm.call.heartbeat (verbose) — periodic liveness while the
    // handler runs. unref'd so it never keeps the process alive.
    const heartbeat = setInterval(() => {
      baseEmit("backend.llm.call.heartbeat", "info", {
        elapsed_ms_since_start: Date.now() - startedAt,
      });
    }, heartbeatMs);
    if (typeof heartbeat.unref === "function") heartbeat.unref();

    let response: Response;
    try {
      response = await handler(req);
    } catch (err) {
      clearInterval(heartbeat);
      // 11) backend.error.caught
      const error = err instanceof Error ? err : new Error(String(err));
      baseEmit(
        "backend.error.caught",
        "err",
        {
          exception_type: error.name,
          message_scrubbed: scrubSecrets(error.message).slice(0, 512),
          stack_brief: briefStack(error),
        },
        Date.now() - startedAt,
      );
      // backend.agent.exit (err) + flush before rethrowing.
      baseEmit("backend.agent.exit", "err", {
        terminal_outcome: "err",
        total_duration_ms: Date.now() - startedAt,
      });
      void emitter.flush();
      throw err;
    }

    clearInterval(heartbeat);

    // 5) backend.llm.call.response (verbose)
    baseEmit(
      "backend.llm.call.response",
      "ok",
      {
        provider,
        model: modelId,
        response_token_count: null,
        latency_ms: Date.now() - startedAt,
        error_class: null,
      },
      Date.now() - startedAt,
    );

    const httpOutcome: CvdiagOutcome = response.ok ? "ok" : "err";

    // Wrap the streaming body to emit sse.first_byte / sse.event / sse.aborted
    // and the terminal response.complete + agent.exit. Non-streaming bodies
    // emit the terminals immediately.
    const wrapped = instrumentBody(response, {
      emit: baseEmit,
      startedAt,
      httpOutcome,
      onComplete: () => void emitter.flush(),
    });
    return wrapped;
  };

  /** Edge-header snapshot that never throws into the wrapped handler. */
  function safeEdgeHeaders(
    req: Request,
  ): ReturnType<typeof filterEdgeHeaders> | undefined {
    try {
      return edgeHeadersFrom(req.headers);
    } catch {
      return undefined;
    }
  }
}

/** Build a ≤8-frame brief stack trace (file:line pairs). */
function briefStack(error: Error): Array<{ file: string; line: number }> {
  const frames: Array<{ file: string; line: number }> = [];
  const stack = error.stack ?? "";
  const lineRe = /\(?([^()\s]+):(\d+):\d+\)?$/;
  for (const raw of stack.split("\n").slice(1)) {
    if (frames.length >= 8) break;
    const m = lineRe.exec(raw.trim());
    if (m) {
      frames.push({
        file: scrubSecrets(m[1]).slice(0, 256),
        line: Number(m[2]),
      });
    }
  }
  return frames;
}

interface InstrumentBodyCtx {
  emit: (
    boundary: Parameters<CvdiagEmitter["emit"]>[0]["boundary"],
    outcome: CvdiagOutcome,
    metadata: Record<string, unknown>,
    durationMs?: number | null,
  ) => CvdiagEnvelope | null;
  startedAt: number;
  httpOutcome: CvdiagOutcome;
  onComplete: () => void;
}

/**
 * Wrap a Response body in a ReadableStream that emits the SSE boundaries:
 *   - backend.sse.first_byte on the first chunk,
 *   - backend.sse.event per chunk (debug tier; gated by the emitter),
 *   - backend.sse.aborted if the source errors,
 *   - backend.response.complete + backend.agent.exit on clean close.
 * A non-streaming (bodyless) Response emits the terminals immediately and is
 * returned untouched. The wrapper forwards chunks verbatim and never throws
 * into the consumer.
 */
function instrumentBody(response: Response, ctx: InstrumentBodyCtx): Response {
  const status = response.status;
  const lenHeader = response.headers.get("content-length");
  const declaredLen =
    lenHeader === null ? null : Number.parseInt(lenHeader, 10);

  if (!response.body) {
    emitTerminals(ctx, status, declaredLen, 0, 0);
    return response;
  }

  const source = response.body;
  let sseCount = 0;
  let totalBytes = 0;
  let firstByteSeen = false;

  const monitored = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
            if (!firstByteSeen) {
              firstByteSeen = true;
              ctx.emit("backend.sse.first_byte", "ok", {
                delta_ms_from_ingress: Date.now() - ctx.startedAt,
              });
            }
            ctx.emit("backend.sse.event", "info", {
              event_type: "chunk",
              payload_size_bytes: value.byteLength,
              sequence_num: sseCount,
            });
            sseCount += 1;
          }
          controller.enqueue(value);
        }
        controller.close();
        emitTerminals(
          ctx,
          status,
          declaredLen ?? totalBytes,
          totalBytes,
          sseCount,
        );
      } catch (err) {
        // Stream aborted mid-flight: emit sse.aborted + err terminals.
        ctx.emit("backend.sse.aborted", "err", {
          termination_kind: "chunk_error",
          bytes_before_abort: totalBytes,
        });
        emitTerminalsErr(ctx, status, totalBytes, sseCount);
        try {
          controller.error(err);
        } catch {
          // already errored/closed
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // already released
        }
      }
    },
    cancel(reason) {
      // Consumer cancelled: treat as a clean-ish abort.
      ctx.emit("backend.sse.aborted", "info", {
        termination_kind: "fin_premature",
        bytes_before_abort: totalBytes,
      });
      emitTerminals(ctx, status, totalBytes, totalBytes, sseCount);
      return source.cancel(reason);
    },
  });

  return new Response(monitored, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** Emit response.complete + agent.exit with the http-derived outcome. */
function emitTerminals(
  ctx: InstrumentBodyCtx,
  httpStatus: number,
  contentLen: number | null,
  _totalBytes: number,
  sseCount: number,
): void {
  const duration = Date.now() - ctx.startedAt;
  ctx.emit(
    "backend.response.complete",
    ctx.httpOutcome,
    {
      http_status: httpStatus,
      content_length: contentLen,
      total_duration_ms: duration,
      sse_event_count: sseCount,
    },
    duration,
  );
  ctx.emit(
    "backend.agent.exit",
    ctx.httpOutcome,
    {
      terminal_outcome: ctx.httpOutcome,
      total_duration_ms: duration,
    },
    duration,
  );
  ctx.onComplete();
}

/** Emit the terminals on the error path (outcome forced to err). */
function emitTerminalsErr(
  ctx: InstrumentBodyCtx,
  httpStatus: number,
  totalBytes: number,
  sseCount: number,
): void {
  const duration = Date.now() - ctx.startedAt;
  ctx.emit(
    "backend.response.complete",
    "err",
    {
      http_status: httpStatus,
      content_length: totalBytes,
      total_duration_ms: duration,
      sse_event_count: sseCount,
    },
    duration,
  );
  ctx.emit(
    "backend.agent.exit",
    "err",
    {
      terminal_outcome: "err",
      total_duration_ms: duration,
    },
    duration,
  );
  ctx.onComplete();
}

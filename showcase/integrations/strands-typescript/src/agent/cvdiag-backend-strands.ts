/**
 * cvdiag-backend-strands.ts — AGENT-SIDE CVDIAG backend instrumentation for the
 * two-process strands-typescript integration.
 *
 * Unlike the four in-process TS integrations (langgraph-typescript,
 * claude-sdk-typescript, mastra, built-in-agent), which wrap their Next route
 * with `withCvdiagBackend` because the model runs in-process, strands runs the
 * model in THIS Express agent process. The Next route is a bare HttpAgent proxy
 * and `@ag-ui/aws-strands@0.2.3` drops inbound x-* before `agent.run()`, so the
 * real backend boundary (the outbound LLM call) AND the per-request header
 * forwarding MUST live here.
 *
 * This module exposes a single Express middleware mounted BEFORE the aws-strands
 * POST handler on the same path. It does TWO things per request:
 *   1. ALWAYS seeds the header-forwarding ALS (`withForwardedHeaders`) so the
 *      outbound OpenAI fetch injects the inbound x-* (incl. `X-AIMock-Strict`).
 *      Header forwarding is INDEPENDENT of the emitter gate.
 *   2. When `CVDIAG_BACKEND_EMITTER` is truthy, emits the backend.* CVDIAG
 *      boundaries around the streamed AG-UI response, adopting the inbound
 *      `x-test-id` as the cross-layer JOIN key.
 *
 * Boundary names + metadata keys are taken VERBATIM from the in-process
 * precedent (`integrations/langgraph-typescript/src/cvdiag-backend.ts`) so the
 * 11 BACKEND_BOUNDARIES validate against the staged `schema.ts` and join in
 * cli-classify. No new boundary strings are invented.
 *
 * GUARDED BY `CVDIAG_BACKEND_EMITTER` (default OFF): when unset the middleware
 * is forwarding-only (still seeds the ALS) and emits nothing. CVDIAG is pure
 * instrumentation — every emit/flush is best-effort and any internal error
 * degrades to `next()` (the request is never blocked or failed by CVDIAG).
 *
 * The emitter barrel is the co-located, build-context-staged copy under
 * `../cvdiag/cvdiag-emitter` (staged by `bin/showcase cvdiag-stage-ts`). The
 * Express agent project has NO `@/` path alias (that is the Next project's
 * tsconfig), so it is imported by RELATIVE path with a `.js` extension (the
 * bundler/tsx resolver maps it to the `.ts` source).
 */

import type { Request, Response, NextFunction } from "express";
import {
  createCvdiagFetchPbWriterFromEnv,
  CvdiagEmitter,
  filterEdgeHeaders,
  mintTestId,
  scrubSecrets,
} from "../cvdiag/cvdiag-emitter.js";
import type {
  CvdiagEnvelope,
  CvdiagOutcome,
  CvdiagPbWriter,
} from "../cvdiag/cvdiag-emitter.js";
import { withForwardedHeaders } from "./header-forwarding.js";

/** Env flag that gates the emitter. Default OFF. */
const ENABLE_ENV = "CVDIAG_BACKEND_EMITTER";

/** Truthy check for the gate (1 / true / yes / on, case-insensitive). */
function isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[ENABLE_ENV];
  if (raw === undefined) return false;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

/**
 * Construct the concrete writer-role PB writer ONCE (env read once at module
 * load). Returns undefined when `CVDIAG_PB_URL` is unset — in which case the
 * emitter is writer-less (stdout-only, no rows persist), matching the precedent.
 */
const pbWriter: CvdiagPbWriter | undefined = createCvdiagFetchPbWriterFromEnv();

/**
 * Read the inbound probe `x-test-id` — the CROSS-LAYER JOIN key. The probe mints
 * a per-run id (`d6-<slug>-<runId>`) and forwards it on every request; the
 * backend adopts it as the envelope `test_id` so its rows join the probe's rows.
 * Returns the trimmed value or undefined (→ the emitter mints a fresh UUIDv7).
 */
function inboundTestId(req: Request): string | undefined {
  try {
    const raw = req.header("x-test-id");
    const trimmed = raw?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

/** Snapshot the allow-listed edge headers off an Express request. */
function edgeHeadersFrom(req: Request): ReturnType<typeof filterEdgeHeaders> {
  const bag: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    bag[k] = Array.isArray(v) ? v.join(",") : (v ?? null);
  }
  return filterEdgeHeaders(bag);
}

/**
 * Byte length of an SSE `res.write` chunk for `payload_size_bytes`. Strings are
 * measured via `Buffer.byteLength`; any `ArrayBufferView` (Buffer, Uint8Array,
 * DataView, etc.) reports its `byteLength` (for Buffer this equals `.length`).
 * Anything else (no chunk / unknown type) is 0.
 */
export function sseChunkByteLength(chunk: unknown): number {
  return typeof chunk === "string"
    ? Buffer.byteLength(chunk)
    : ArrayBuffer.isView(chunk)
      ? chunk.byteLength
      : 0;
}

export interface StrandsCvdiagOptions {
  /** Integration slug ("strands-typescript"). */
  slug: string;
  /** Agent name to stamp on backend.agent.enter. */
  agentName: string;
  /** Provider label for backend.llm.call.* (defaults to "openai"). */
  provider?: string;
  /** Best-effort model identifier for backend.agent.enter / llm.call.*. */
  modelId?: string;
}

/**
 * Express middleware mounted BEFORE the aws-strands POST handler on the same
 * path. Always seeds the forwarding ALS (so the outbound OpenAI fetch injects
 * x-*); when the emitter is enabled it also emits the backend.* boundaries
 * around the streamed AG-UI response. Crash-proof: any CVDIAG error degrades to
 * `next()`.
 */
export function strandsCvdiagMiddleware(opts: StrandsCvdiagOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Header forwarding (§3) is independent of the emitter gate: ALWAYS run the
    // remainder of the request inside the forwarding ALS scope. Because the
    // aws-strands handler + agent.run() + the streamed res.write() calls all run
    // synchronously-then-async inside this next() chain, AsyncLocalStorage
    // propagates the snapshot across the awaits to the outbound fetch.
    withForwardedHeaders(req, () => {
      if (!isEnabled()) {
        next();
        return;
      }
      try {
        runWithEmitter(req, res, next, opts);
      } catch {
        // CVDIAG must never block the request.
        next();
      }
    });
  };
}

function runWithEmitter(
  req: Request,
  res: Response,
  next: NextFunction,
  opts: StrandsCvdiagOptions,
): void {
  const provider = opts.provider ?? "openai";
  const modelId = opts.modelId ?? "unknown";
  const emitter = new CvdiagEmitter({
    layer: "backend",
    autoFlush: true,
    pbWriter,
  });
  // CROSS-LAYER JOIN: adopt the inbound probe x-test-id as the envelope test_id;
  // traceId is a fresh per-request UUIDv7 kept distinct from the shared run id.
  const testId = inboundTestId(req);
  const traceId = mintTestId();
  const startedAt = Date.now();
  const edgeHeaders = (() => {
    try {
      return edgeHeadersFrom(req);
    } catch {
      return undefined;
    }
  })();

  const emit = (
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
  emit("backend.request.ingress", "info", {
    method: req.method,
    path: scrubSecrets(req.path),
    content_length: Number(req.header("content-length")) || null,
  });
  // 2) backend.agent.enter
  emit("backend.agent.enter", "info", {
    agent_name: opts.agentName,
    model_id: modelId,
  });
  // 3) backend.llm.call.start
  emit("backend.llm.call.start", "info", {
    provider,
    model: modelId,
    prompt_token_count_estimate: 0,
  });

  // Hook the Express response stream. The aws-strands handler calls
  // res.write()/res.end(); wrap them to emit sse.first_byte / sse.event /
  // response.complete / agent.exit. Wrappers forward verbatim and never throw
  // into the underlying write.
  let firstByte = false;
  let sseCount = 0;
  let terminalsEmitted = false;
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);

  res.write = ((chunk: unknown, ...rest: unknown[]) => {
    try {
      if (!firstByte) {
        firstByte = true;
        emit("backend.sse.first_byte", "ok", {
          delta_ms_from_ingress: Date.now() - startedAt,
        });
      }
      const size = sseChunkByteLength(chunk);
      emit("backend.sse.event", "info", {
        event_type: "chunk",
        payload_size_bytes: size,
        sequence_num: sseCount,
      });
      sseCount += 1;
    } catch {
      /* instrumentation must never break the stream */
    }
    return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof res.write;

  res.end = ((...args: unknown[]) => {
    try {
      if (!terminalsEmitted) {
        terminalsEmitted = true;
        const dur = Date.now() - startedAt;
        const outcome: CvdiagOutcome = res.statusCode >= 400 ? "err" : "ok";
        // 5) backend.llm.call.response
        emit(
          "backend.llm.call.response",
          outcome,
          {
            provider,
            model: modelId,
            response_token_count: null,
            latency_ms: dur,
            error_class: null,
          },
          dur,
        );
        // 10) backend.response.complete
        emit(
          "backend.response.complete",
          outcome,
          {
            http_status: res.statusCode,
            sse_event_count: sseCount,
            total_duration_ms: dur,
          },
          dur,
        );
        // 9) backend.agent.exit
        emit(
          "backend.agent.exit",
          outcome,
          { terminal_outcome: outcome, total_duration_ms: dur },
          dur,
        );
        void emitter.flush();
      }
    } catch {
      /* never throw into res.end */
    }
    return (origEnd as (...a: unknown[]) => Response)(...args);
  }) as typeof res.end;

  res.once("error", () => {
    try {
      if (!terminalsEmitted) {
        terminalsEmitted = true;
        const dur = Date.now() - startedAt;
        emit("backend.sse.aborted", "err", {
          termination_kind: "chunk_error",
          bytes_before_abort: 0,
        });
        emit(
          "backend.agent.exit",
          "err",
          { terminal_outcome: "err", total_duration_ms: dur },
          dur,
        );
        void emitter.flush();
      }
    } catch {
      /* never throw */
    }
  });

  next();
}

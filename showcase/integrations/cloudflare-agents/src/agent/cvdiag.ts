/**
 * CVDIAG backend instrumentation, in the Worker that runs the model.
 *
 * cloudflare-agents is a two-process integration: the Next.js route is a bare
 * HttpAgent proxy and the model call happens here, in the Worker (the agent's
 * Durable Object). So the backend.* boundaries are emitted here, around the
 * Worker's response stream, the way strands-typescript emits them from its
 * Express agent (`strands-typescript/src/agent/cvdiag-backend-strands.ts`).
 * Boundary names and metadata keys are the same, so the rows validate against
 * the staged schema and join in `bin/showcase cvdiag classify`.
 *
 * Gated by `CVDIAG_BACKEND_EMITTER` (off by default). The emitter adopts the
 * inbound `x-test-id` as the cross-layer join key and persists through the
 * writer-role PocketBase writer when `CVDIAG_PB_URL` / `CVDIAG_WRITER_KEY` are
 * set. The emitter module is the co-located copy `bin/showcase
 * cvdiag-stage-ts` stages into `../cvdiag`; it runs on workerd under
 * `nodejs_compat` (node:crypto, Buffer, process.env), given a bound `fetch`
 * (see `pbWriter`). CVDIAG never fails a request: every error falls back to
 * the plain response.
 */
import {
  CvdiagEmitter,
  CvdiagFetchPbWriter,
  filterEdgeHeaders,
  mintTestId,
  scrubSecrets,
} from "../cvdiag/cvdiag-emitter";
import type { CvdiagOutcome, CvdiagPbWriter } from "../cvdiag/cvdiag-emitter";

export type CvdiagEnv = Record<string, unknown>;

interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

export interface CvdiagOptions {
  slug: string;
  agentName: string;
  provider?: string;
  modelId?: string;
}

/** True when `CVDIAG_BACKEND_EMITTER` is 1 / true / yes / on. */
export function cvdiagEnabled(env: CvdiagEnv): boolean {
  const raw = env.CVDIAG_BACKEND_EMITTER;
  return typeof raw === "string" && /^(1|true|yes|on)$/i.test(raw.trim());
}

/** The string bindings, as the env bag the emitter reads. */
function stringEnv(env: CvdiagEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

let writer: CvdiagPbWriter | undefined | null = null;

/**
 * One writer per isolate, created from the first request's bindings, with the
 * same settings `createCvdiagFetchPbWriterFromEnv` reads. The writer is given
 * a `fetch` bound to the global scope: by default it stores the global
 * `fetch` and calls it as its own method, which workerd rejects ("Illegal
 * invocation"), so every write would fail as a transport error.
 */
function pbWriter(
  env: Record<string, string | undefined>,
): CvdiagPbWriter | undefined {
  if (writer !== null) return writer;
  const baseUrl = env.CVDIAG_PB_URL?.trim();
  const writerKey = env.CVDIAG_WRITER_KEY?.trim();
  const writerIdentity = env.CVDIAG_WRITER_IDENTITY?.trim();
  writer =
    baseUrl && writerKey
      ? new CvdiagFetchPbWriter({
          baseUrl,
          writerKey,
          writerIdentity: writerIdentity || undefined,
          fetchImpl: (input, init) => fetch(input, init),
        })
      : undefined;
  return writer;
}

/**
 * Runs `handle` and, when the emitter is on, emits the backend.* boundaries
 * around its response: ingress, agent enter and LLM call start up front, the
 * first byte and every chunk as the body streams, and the response, LLM and
 * agent-exit terminals when it ends (or `sse.aborted` when it fails).
 */
export async function withCvdiag(
  request: Request,
  env: CvdiagEnv,
  ctx: WaitUntil,
  options: CvdiagOptions,
  handle: (request: Request) => Promise<Response>,
): Promise<Response> {
  if (!cvdiagEnabled(env)) return handle(request);

  let emit: (
    boundary: Parameters<CvdiagEmitter["emit"]>[0]["boundary"],
    outcome: CvdiagOutcome,
    metadata: Record<string, unknown>,
    durationMs?: number | null,
  ) => void;
  let flush: () => void;
  const startedAt = Date.now();
  const provider = options.provider ?? "openai";
  const modelId = options.modelId ?? "unknown";
  try {
    const bag = stringEnv(env);
    const emitter = new CvdiagEmitter({
      layer: "backend",
      env: bag,
      pbWriter: pbWriter(bag),
    });
    const testId = request.headers.get("x-test-id")?.trim() || undefined;
    const traceId = mintTestId();
    const headerBag: Record<string, string | null> = {};
    request.headers.forEach((value, key) => {
      headerBag[key] = value;
    });
    const edgeHeaders = filterEdgeHeaders(headerBag);
    emit = (boundary, outcome, metadata, durationMs = null) => {
      emitter.emit({
        layer: "backend",
        boundary,
        slug: options.slug,
        demo: options.slug,
        outcome,
        testId,
        traceId,
        edgeHeaders,
        metadata,
        durationMs,
      });
    };
    flush = () => ctx.waitUntil(emitter.flush());

    emit("backend.request.ingress", "info", {
      method: request.method,
      path: scrubSecrets(new URL(request.url).pathname),
      content_length: Number(request.headers.get("content-length")) || null,
    });
    emit("backend.agent.enter", "info", {
      agent_name: options.agentName,
      model_id: modelId,
    });
    emit("backend.llm.call.start", "info", {
      provider,
      model: modelId,
      prompt_token_count_estimate: 0,
    });
  } catch {
    return handle(request);
  }

  const response = await handle(request);
  // A WebSocket upgrade has no body to observe.
  if (response.status === 101) return response;
  if (!response.body) {
    const dur = Date.now() - startedAt;
    const outcome: CvdiagOutcome = response.status >= 400 ? "err" : "ok";
    emit(
      "backend.response.complete",
      outcome,
      {
        http_status: response.status,
        sse_event_count: 0,
        total_duration_ms: dur,
      },
      dur,
    );
    emit(
      "backend.agent.exit",
      outcome,
      { terminal_outcome: outcome, total_duration_ms: dur },
      dur,
    );
    flush();
    return response;
  }

  let chunks = 0;
  let bytes = 0;
  let ended = false;
  const finish = (failed: boolean) => {
    if (ended) return;
    ended = true;
    try {
      const dur = Date.now() - startedAt;
      if (failed) {
        emit("backend.sse.aborted", "err", {
          termination_kind: "chunk_error",
          bytes_before_abort: bytes,
        });
        emit(
          "backend.agent.exit",
          "err",
          { terminal_outcome: "err", total_duration_ms: dur },
          dur,
        );
      } else {
        const outcome: CvdiagOutcome = response.status >= 400 ? "err" : "ok";
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
        emit(
          "backend.response.complete",
          outcome,
          {
            http_status: response.status,
            sse_event_count: chunks,
            total_duration_ms: dur,
          },
          dur,
        );
        emit(
          "backend.agent.exit",
          outcome,
          { terminal_outcome: outcome, total_duration_ms: dur },
          dur,
        );
      }
      flush();
    } catch {
      // Instrumentation never breaks the stream.
    }
  };

  const observed = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        try {
          if (chunks === 0) {
            emit("backend.sse.first_byte", "ok", {
              delta_ms_from_ingress: Date.now() - startedAt,
            });
          }
          emit("backend.sse.event", "info", {
            event_type: "chunk",
            payload_size_bytes: chunk.byteLength,
            sequence_num: chunks,
          });
        } catch {
          // Instrumentation never breaks the stream.
        }
        chunks += 1;
        bytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
      flush() {
        finish(false);
      },
      cancel() {
        finish(true);
      },
    }),
  );
  return new Response(observed, response);
}

/**
 * agent_server.ts — standalone AG-UI HTTP agent server for the mastra
 * showcase integration.
 *
 * WHY THIS EXISTS
 * Every other showcase integration runs its agent as a SEPARATE process that
 * speaks AG-UI over HTTP, with the Next.js layer proxying to it. mastra was
 * the exception: it ran the Mastra agents in-process inside Next.js. This
 * server puts mastra on the normal path so one shared frontend can reach it
 * over the network exactly like the other integrations. Reference shapes:
 * `strands-typescript/src/agent/server.ts` and
 * `claude-sdk-typescript/src/agent_server.ts`.
 *
 * PACKAGING CHANGE ONLY. Agent behaviour, prompts, tools, model config and
 * resourceIds are untouched — the agents come from `@/agent-registry`, the
 * same map the Next.js route builds.
 *
 * WIRE CONTRACT
 *   POST /<agent-name>   →  AG-UI SSE stream (`data: <json>\n\n` per event)
 *   GET  /health         →  {status, integration, timestamp}
 *   GET  /api/health     →  same handler (see the health note below)
 *
 * Run with `node --import tsx src/agent_server.ts` from the package root
 * (tsx is a one-shot ESM loader here, NOT a watcher; it also resolves the
 * tsconfig `@/*` and `@copilotkit/showcase-shared-tools` path aliases that
 * `src/mastra/**` relies on).
 */

import express from "express";
import type {
  ErrorRequestHandler,
  Express,
  Request as ExpressRequest,
  RequestHandler,
  Response as ExpressResponse,
} from "express";
import { EventEncoder } from "@ag-ui/encoder";
import { EventType } from "@ag-ui/core";
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import { MastraAgent, getLocalAgent } from "@ag-ui/mastra";
import { mastra } from "@/mastra";
import { getAgents } from "@/agent-registry";
import type { BuiltAgents } from "@/agent-registry";
// `withForwardedHeaders` binds inbound x-* headers (notably x-aimock-context)
// into an AsyncLocalStorage scope so the wrapped @ai-sdk/openai provider
// re-attaches them on outbound LLM calls. The @ag-ui/mastra adapter does NOT
// forward inbound headers itself, so this scope is the ONLY thing that gets
// the fixture discriminator onto the outbound call. Load-bearing for the
// recorded-fixture tests: drop it and every mastra cell goes red.
import { withForwardedHeaders } from "@/mastra/_header_forwarding";
// CVDIAG backend instrumentation (L1-E). Transparent pass-through with zero
// overhead unless CVDIAG_BACKEND_EMITTER is truthy (default OFF).
import { withCvdiagBackend } from "@/cvdiag-backend";

/** The concrete AG-UI agent type the registry hands back. */
type AguiAgent = BuiltAgents["weatherAgent"];

/**
 * PORT: `AGENT_PORT`, defaulting to 8000 — deliberately NOT `$PORT`.
 *
 * The container still runs Next.js on `$PORT` in this phase (see
 * entrypoint.sh, which starts BOTH processes). Binding `$PORT` here would
 * collide with Next.js and break the container. `AGENT_PORT` is unset in
 * every deployment today, so this lands on 8000 — the same port every other
 * showcase agent process uses. When the Next.js half is removed in a later
 * phase, point the entrypoint at `AGENT_PORT=$PORT` rather than changing this
 * default.
 */
const DEFAULT_PORT = "8000";

/**
 * Parse + validate the bind port. `Number.parseInt` alone is a trap here:
 * `""`, `"eight"` and a literal `"$PORT"` (what you get when `PORT` is unset
 * and the entrypoint is edited to `AGENT_PORT=$PORT`) all yield `NaN`, and
 * `app.listen(NaN)` binds a RANDOM ephemeral port instead of failing. The
 * startup banner then prints `0.0.0.0:NaN`, the watchdog's `/health` probe
 * hits :8000 and gets nothing, and the container restart-loops with no line
 * anywhere explaining why. Since the documented upgrade path in the comment
 * above literally tells the next person to set `AGENT_PORT=$PORT`, this trap
 * sits directly on the path we point people at. Exit non-zero instead.
 *
 * WHY A REGEX AND NOT JUST `Number`
 * `Number.parseInt` was rejected because it stops at the first non-digit, but
 * `Number` has its own laxity that the promise "an integer in 1..65535" does not
 * cover: `Number("8e3")` is 8000, `Number("0x1F90")` is 8080, `Number("8000.0")`
 * is 8000 and PASSES `Number.isInteger`, and `Number("\n8000 ")` is 8000. Each
 * one makes the startup banner print a port the operator never typed, on the
 * same documented `AGENT_PORT=$PORT` upgrade path this function exists to
 * protect. So require a plain decimal integer literal BEFORE converting.
 */
const DECIMAL_PORT_PATTERN = /^\d{1,5}$/;

function resolvePort(raw: string | undefined): number {
  const value = raw ?? DEFAULT_PORT;
  // `Number("")` and `Number(" ")` are 0, and port 0 asks the OS for a RANDOM
  // ephemeral port — the exact silent failure we are closing. Reject both the
  // blank forms and 0 itself; a deployment never wants an ephemeral port here.
  // The regex runs on the TRIMMED value (surrounding whitespace in an env var is
  // an editing artefact, not intent) but rejects every other non-decimal form.
  const trimmed = value.trim();
  const parsed = DECIMAL_PORT_PATTERN.test(trimmed)
    ? Number(trimmed)
    : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    console.error(
      `[agent_server] FATAL: AGENT_PORT must be a decimal integer in 1..65535 (no hex, exponent or ` +
        `fractional forms), got ${JSON.stringify(value)}. ` +
        `Refusing to start — an unparseable port makes app.listen() bind a random ephemeral port, ` +
        `which fails the /health watchdog with no diagnostic.`,
    );
    process.exit(1);
  }
  return parsed;
}

/** Bind address, defaulting to every interface (containers need this). */
const DEFAULT_HOST = "0.0.0.0";

/**
 * Parse + validate the bind address.
 *
 * `process.env.AGENT_HOST ?? DEFAULT_HOST` was NOT enough, and it defeated the
 * argument `resolvePort` above is built on. `??` only replaces `undefined`, so an
 * EMPTY or whitespace `AGENT_HOST` — which is what an entrypoint edited to
 * `AGENT_HOST=$HOST` produces when `HOST` is unset, the same deployment path
 * `resolvePort` guards — reaches `app.listen(PORT, "")`. The banner then prints
 * `:8000` with no host, the bind is not the bind anyone intended, and the
 * container fails its healthcheck with nothing in the log naming the cause. A
 * literal unexpanded `"$HOST"` is rejected for the same reason: it resolves to
 * nothing bindable and produces an async EADDRNOTAVAIL instead of a diagnosis.
 */
function resolveHost(raw: string | undefined): string {
  if (raw === undefined) return DEFAULT_HOST;
  const value = raw.trim();
  if (value === "" || value.startsWith("$")) {
    console.error(
      `[agent_server] FATAL: AGENT_HOST must be a bindable host, got ${JSON.stringify(raw)}. ` +
        `Refusing to start — a blank or unexpanded host binds nothing useful and fails the /health ` +
        `watchdog with no diagnostic. Unset AGENT_HOST to bind ${DEFAULT_HOST}.`,
    );
    process.exit(1);
  }
  return value;
}

const PORT = resolvePort(process.env.AGENT_PORT);
const HOST = resolveHost(process.env.AGENT_HOST);

/**
 * Per-request parsed AG-UI input, keyed by the synthetic Web `Request` we
 * hand to the CVDIAG / header-forwarding wrappers.
 *
 * Both wrappers are written against the Web handler shape
 * `(req: Request) => Promise<Response>`, so we adapt the Express request into
 * a Web `Request`. Express has already consumed and parsed the JSON body by
 * then, so rather than re-serialising a possibly multi-megabyte multimodal
 * payload back into the synthetic request we stash the parsed value here and
 * pick it up inside the handler. A WeakMap, so a dropped request is collected
 * together with its input.
 */
const inputByRequest = new WeakMap<Request, RunAgentInput>();

/**
 * Convert Express's plain header object into a Web `Headers`.
 *
 * `withForwardedHeaders` and `withCvdiagBackend` both read `req.headers` as a
 * Web `Headers`; Express exposes a plain object whose values may be arrays.
 * Array values are joined with "," (the standard multi-value header form),
 * matching `strands-typescript/src/agent/header-forwarding.ts`. Each `set` is
 * guarded because `Headers.set` throws on a syntactically invalid header
 * name — one malformed inbound header must not fail the run.
 *
 * TWO THINGS THE GUARD MUST DO, WHICH AN EMPTY CATCH DOES NOT
 *  1. NAME the header it dropped. A wordlessly discarded header is invisible,
 *     and the symptom it produces downstream (a run that behaves as if the
 *     header was never sent) points at the model, not at this line. We log the
 *     name only — header VALUES carry auth tokens and must never be logged.
 *  2. Hard-fail on `x-aimock-context`. That header is the aimock fixture
 *     discriminator (see the import comment above): drop it and every fixture
 *     lookup misses, which surfaces as an LLM/prompt failure across every
 *     mastra cell at once. Failing the single request loudly is strictly
 *     better than a whole red suite with a misleading cause.
 */
const FIXTURE_DISCRIMINATOR_HEADER = "x-aimock-context";

function toWebHeaders(req: ExpressRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    try {
      headers.set(key, Array.isArray(value) ? value.join(",") : String(value));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (key.toLowerCase() === FIXTURE_DISCRIMINATOR_HEADER) {
        throw new Error(
          `[agent_server] inbound "${FIXTURE_DISCRIMINATOR_HEADER}" header is malformed and cannot be ` +
            `forwarded (${reason}). Refusing the run: without this header every aimock fixture lookup ` +
            `misses and the failure would present as a model error.`,
          { cause: err },
        );
      }
      // Log the NAME only — never the value (headers carry credentials).
      console.warn(
        `[agent_server] dropped malformed inbound header "${key}": ${reason}`,
      );
    }
  }
  return headers;
}

/**
 * Build the synthetic Web `Request` the CVDIAG + header-forwarding wrappers
 * see. Body-less on purpose (see `inputByRequest`): neither wrapper reads the
 * body, they read method / url / headers only.
 */
function toWebRequest(req: ExpressRequest, input: RunAgentInput): Request {
  const host = req.headers.host ?? "localhost";
  const webRequest = new Request(`http://${host}${req.originalUrl}`, {
    method: "POST",
    headers: toWebHeaders(req),
  });
  inputByRequest.set(webRequest, input);
  return webRequest;
}

/**
 * Run one agent turn and return the AG-UI SSE stream as a Web `Response`.
 *
 * `agent.run()` is subscribed inside `ReadableStream.start`, which the
 * `ReadableStream` constructor invokes SYNCHRONOUSLY. That matters: this
 * function is called inside the `withForwardedHeaders` AsyncLocalStorage
 * scope, so the subscription — and therefore every outbound LLM call the
 * agent makes while streaming — runs inside that scope and carries the
 * inbound x-* headers. This is exactly the property the in-process Next.js
 * route relies on today; do NOT defer the subscription out of `start`.
 */
function streamAgentRun(agent: AguiAgent, input: RunAgentInput): Response {
  const encoder = new EventEncoder({ accept: "text/event-stream" });
  const textEncoder = new TextEncoder();

  /**
   * The live subscription, plus the teardown both termination paths share.
   *
   * WHY A HOLDER AND NOT A `let unsubscribe` ASSIGNED AFTER `subscribe()`
   * Two paths end this stream, and BOTH must stop the Mastra run:
   *   - `cancel`      — the client went away.
   *   - `failStream`  — WE ended it (an encode failure, or an error escaping
   *                     the adapter). This path used to only `close()`, so the
   *                     run kept going against a dead controller: every later
   *                     event hit `if (closed) return` and was discarded, every
   *                     later error vanished into the same guard, and the run
   *                     burned tokens to completion with nobody reading it.
   * `failStream` can fire SYNCHRONOUSLY from the first event, before
   * `subscribe()` has returned — at which point there is no subscription object
   * to unsubscribe yet. `unsubscribe?.()` would silently no-op there and leave
   * exactly the unstoppable run we are fixing, so `teardown` records the intent
   * and `start` re-applies it the moment the subscription exists.
   */
  let subscription: { unsubscribe: () => void } | null = null;
  let teardownRequested = false;
  const teardown = (): void => {
    teardownRequested = true;
    if (!subscription) return;
    const live = subscription;
    subscription = null;
    live.unsubscribe();
  };

  /**
   * True once this controller has reached a terminal state, by ANY route.
   *
   * DECLARED OUT HERE, not inside `start`, because `cancel` must set it too and
   * `cancel` is a sibling of `start`. That is the whole point: the three ways
   * this controller finishes are `close()`, the escalation's
   * `controller.error()`, and the stream's `cancel` (the client disconnect),
   * and only if ALL THREE record the fact can `enqueue` tell "the consumer went
   * away" apart from a genuine bug. `cancel` used to tear the subscription down
   * without setting it, which is exactly how an ordinary tab-close produced two
   * ERROR lines below claiming the stream was still writable.
   */
  let closed = false;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = (): void => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed/errored — nothing to do.
        }
      };
      /**
       * True while `failStream` is emitting its own terminal frame. `failStream`
       * emits THROUGH `enqueue`, so the escalation below would recurse without
       * this — and a controller that cannot take the terminal frame would drop
       * it silently, leaving the client a bare truncated 200.
       */
      let emittingTerminalFrame = false;

      /**
       * Enqueue one already-encoded frame.
       *
       * The benign failure is "the consumer went away", which `enqueue` raises
       * on a closed or errored controller — a race with `cancel`. A bare catch
       * ALSO swallowed everything else (a `TypeError` from an invalid chunk, any
       * future enqueue validation), which is the same conflation `write` below
       * was refactored to remove. The two are told apart by the `closed` flag
       * above, which every terminal route now sets.
       *
       * NOT BY `desiredSize`. This guard used to read `desiredSize === null` as
       * "controller finished", and that is wrong in both directions — measured
       * on Node 24, not assumed:
       *   - after `reader.cancel()`   -> `desiredSize` is 0, NOT null
       *   - after `controller.close()`-> `desiredSize` is 0, NOT null
       *   - after `controller.error()`-> `desiredSize` is null
       *   - healthy, queue full       -> `desiredSize` is 0 or negative
       * Only the ERRORED state reports null, so the disconnect race (which is
       * the closed state, and which throws `TypeError: Invalid state: Controller
       * is already closed`) fell straight through the filter; and 0 is also
       * ordinary backpressure, so widening the test to `<= 0` would have
       * swallowed real bugs instead. The flag is the only honest signal.
       *
       * AND IT IS ESCALATED, NOT LOGGED. This used to log and return, which
       * dropped that one frame and kept streaming — precisely the outcome
       * `write` refuses below, for the reason spelled out there: losing
       * individual events while the stream keeps looking healthy hands the
       * client a plausible-but-wrong transcript, which is worse than truncation
       * because nothing signals the loss. Same outcome, same rule.
       */
      const enqueue = (chunk: Uint8Array): void => {
        try {
          controller.enqueue(chunk);
        } catch (err) {
          // Benign: we closed it, we errored it, or the client disconnected and
          // `cancel` ran. Nothing to report — this is the normal end of a
          // stream, not a fault.
          if (closed) return;
          const reason = err instanceof Error ? err.message : String(err);
          console.error(
            `[agent_server] failed to enqueue a ${chunk.byteLength}-byte SSE frame while the stream ` +
              `was still open (no close, no error, no client disconnect recorded): ${reason}`,
            err instanceof Error ? err.stack : undefined,
          );
          if (emittingTerminalFrame) {
            // The terminal RUN_ERROR ITSELF could not be enqueued. There is no
            // third thing to try, and returning here would silently truncate.
            // Error the stream instead: the reader in `pipeWebResponse` sees a
            // rejected `read()`, which is already routed to a terminal
            // RUN_ERROR written straight onto the committed SSE response.
            console.error(
              `[agent_server] could not enqueue the terminal RUN_ERROR frame either; erroring the ` +
                `stream so the client sees a failure instead of a clean truncation`,
            );
            closed = true;
            try {
              controller.error(
                err instanceof Error ? err : new Error(String(err)),
              );
            } catch {
              // Controller already closed/errored — nothing left to signal.
            }
            teardown();
            return;
          }
          failStream(
            `failed to enqueue a ${chunk.byteLength}-byte SSE frame: ${reason}`,
            "ENQUEUE_ERROR",
          );
        }
      };

      /**
       * Terminal RUN_ERROR frame, built from primitives only so its own
       * encoding cannot fail the way the event that triggered it did.
       *
       * Tears the subscription down after closing: nobody will read another
       * event off this stream, so letting the Mastra run continue only burns
       * tokens and holds resources (see the `teardown` comment above).
       */
      const failStream = (message: string, code: string): void => {
        if (closed) return;
        // Flagged for the whole emit: `enqueue` escalates its own failures back
        // through here, and this is what stops that from recursing.
        emittingTerminalFrame = true;
        try {
          enqueue(
            textEncoder.encode(
              encoder.encode({
                type: EventType.RUN_ERROR,
                message,
                code,
              } as BaseEvent),
            ),
          );
        } finally {
          emittingTerminalFrame = false;
        }
        close();
        teardown();
      };

      /**
       * Encode + enqueue one agent event.
       *
       * ENCODE FAILURES ARE NOT SWALLOWED. The old single try/catch wrapped
       * both the encode and the enqueue and dropped either silently. An
       * `encoder.encode` throw (a non-serialisable tool result, say) is a
       * different failure from "consumer went away": swallowing it loses
       * individual events while the stream keeps looking healthy, so the
       * client gets a plausible-but-wrong transcript — worse than truncation,
       * because nothing signals that anything was lost. Turn it into a
       * terminal RUN_ERROR instead. (RxJS routes a throw from a `next`
       * callback to the global unhandled-error handler, NOT to the `error`
       * callback, so this cannot be left to the subscription's error path.)
       */
      const write = (event: BaseEvent): void => {
        if (closed) return;
        let chunk: Uint8Array;
        try {
          chunk = textEncoder.encode(encoder.encode(event));
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          console.error(
            `[agent_server] failed to encode ${String(event.type)} event: ${reason}`,
          );
          failStream(
            `failed to encode ${String(event.type)} event: ${reason}`,
            "ENCODE_ERROR",
          );
          return;
        }
        enqueue(chunk);
      };

      const live = agent.run(input).subscribe({
        next: write,
        error: (err: unknown) => {
          // The adapter normally turns failures into RUN_ERROR itself. If one
          // escapes, surface it on the wire instead of a silently truncated
          // stream, then close so the client sees a terminal event.
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[agent_server] agent run error: ${message}`);
          failStream(message, "MASTRA_ERROR");
        },
        complete: close,
      });

      subscription = live;
      // A SYNCHRONOUS failure above already asked for teardown while
      // `subscription` was still null. Apply it now that the object exists —
      // without this the run started inside `subscribe()` would keep going with
      // no consumer and no way to stop it.
      if (teardownRequested) teardown();
    },
    cancel() {
      // Client disconnected. The controller is now in the CLOSED state, so
      // record that before tearing down: `write`/`failStream` bail on `closed`,
      // and any enqueue that still races through recognises this as the benign
      // disconnect instead of logging a bug. Setting it first also means the
      // synchronous unsubscribe below cannot re-enter with a stale flag.
      closed = true;
      // Unsubscribing stops the Mastra run and releases its in-flight resources
      // instead of streaming into a dead socket.
      teardown();
    },
  });

  // NO `Connection: keep-alive` HERE. `pipeWebResponse` forwards these headers
  // verbatim onto the Node `ServerResponse`, and Node manages `Connection`
  // itself — setting it by hand is documented as interfering with its keep-alive
  // and chunked-encoding handling. The header is also a no-op on HTTP/1.1 (where
  // persistent connections are the default) and illegal on HTTP/2. `pipeWebResponse`
  // strips hop-by-hop headers as a second line of defence; this is the first.
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      // Railway / nginx-class proxies buffer streamed bodies without this.
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Build the CVDIAG-wrapped Web handler for one agent. Wrapped ONCE per agent
 * at mount time, never per request, so `withCvdiagBackend`'s "gate off →
 * transparent pass-through, zero overhead" property is preserved exactly.
 */
function makeWebHandler(
  agentName: string,
  agent: AguiAgent,
): (req: Request) => Promise<Response> {
  const handler = async (req: Request): Promise<Response> => {
    const input = inputByRequest.get(req);
    if (input === undefined) {
      // Structurally impossible — `toWebRequest` always registers the input.
      throw new Error(`[agent_server] missing RunAgentInput for ${agentName}`);
    }
    // Re-establish the header-forwarding scope at THIS server's request
    // boundary, exactly as the in-process Next.js route does. Everything the
    // agent does downstream — including the outbound LLM call — runs inside
    // it.
    return withForwardedHeaders(req, () => streamAgentRun(agent, input));
  };

  return withCvdiagBackend(handler, {
    slug: "mastra",
    agentName,
    provider: "openai",
  });
}

/**
 * Node socket/stream error codes that mean "the peer hung up", not "our stream
 * broke". A write to a socket the client already closed lands here, and there
 * is nobody left to send a RUN_ERROR to.
 */
const CLIENT_DISCONNECT_CODES = new Set([
  "EPIPE",
  "ECONNRESET",
  "ERR_STREAM_DESTROYED",
  "ERR_STREAM_PREMATURE_CLOSE",
  "ERR_STREAM_WRITE_AFTER_END",
  "ABORT_ERR",
]);

function isClientDisconnect(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && CLIENT_DISCONNECT_CODES.has(code))
    return true;
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Connection-scoped ("hop-by-hop") headers, which a proxy must consume rather
 * than forward. Node's HTTP layer owns every one of these on the outbound
 * response; `pipeWebResponse` drops them instead of copying them through.
 * The list is RFC 9110 §7.6.1 plus `keep-alive`, which is the historic
 * companion to `Connection: keep-alive`.
 */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
]);

/**
 * Terminal RUN_ERROR frame written straight onto an already-committed SSE
 * response. Same wire shape `streamAgentRun` emits, so a client needs no
 * special case for it.
 */
function writeTerminalRunError(res: ExpressResponse, message: string): void {
  const encoder = new EventEncoder({ accept: "text/event-stream" });
  res.write(
    encoder.encode({
      type: EventType.RUN_ERROR,
      message,
      code: "STREAM_ERROR",
    } as BaseEvent),
  );
}

/**
 * Pipe a Web `Response` (streamed or not) out through an Express response.
 *
 * WHY THE CATCH WRITES A TERMINAL EVENT
 * `res.flushHeaders()` above commits HTTP 200 before the first chunk, so once
 * we are streaming there is no status code left to fail with. If a later
 * failure only logged and fell through to `res.end()`, the client would get a
 * well-formed 200 whose event stream simply STOPS: no RUN_ERROR, no non-2xx.
 * A socket write failure, a `reader.read()` rejection, an encoder failure and
 * a provider reset would all be indistinguishable on the wire, and a truncated
 * stream is routinely misdiagnosed as a model or prompt problem. So we emit a
 * terminal AG-UI RUN_ERROR frame before ending.
 *
 * WHEN WE DO NOT
 * If the client is already gone — it closed the tab, or the error IS the
 * disconnect — there is no reader for the frame and writing it would only
 * raise a second error. Those two cases are distinguished explicitly: the
 * `close` listener's `clientGone` flag, and `isClientDisconnect(err)`.
 */
async function pipeWebResponse(
  webResponse: Response,
  res: ExpressResponse,
): Promise<void> {
  res.status(webResponse.status);
  webResponse.headers.forEach((value, key) => {
    // HOP-BY-HOP HEADERS ARE NOT FORWARDED. They describe THIS connection, not
    // the message, and Node owns them: it computes `Transfer-Encoding` from
    // whether a `Content-Length` is known, and manages `Connection` /
    // keep-alive itself. Copying either one onto the `ServerResponse` is
    // documented as interfering with that handling — a hand-set
    // `Transfer-Encoding` in particular can produce a doubly-framed or
    // unframed body, which on a committed SSE response is an unparseable
    // stream with no error anywhere. A Web `Response` should never carry these
    // (see `streamAgentRun`), but this loop copies whatever it is handed, so
    // the filter belongs here rather than resting on every producer.
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return;
    res.setHeader(key, value);
  });
  res.flushHeaders();

  if (!webResponse.body) {
    res.end();
    return;
  }

  const reader = webResponse.body.getReader();
  let clientGone = false;
  /**
   * The first error `res` emitted, if any. Also a LOOP-BREAK condition: the
   * emit can land while we are parked in `reader.read()`, and neither
   * `writableEnded` nor `destroyed` is guaranteed to be true by the time we
   * look again.
   */
  let socketError: unknown = null;

  const cancelReader = (): void => {
    // Cancelling the reader propagates to the stream's `cancel`, which
    // unsubscribes from the Mastra run.
    void reader.cancel().catch(() => undefined);
  };

  const onClose = (): void => {
    clientGone = true;
    cancelReader();
  };
  res.once("close", onClose);

  /**
   * PERSISTENT `error` listener — this is not optional bookkeeping, it is what
   * keeps ONE dropped client socket from killing the whole process.
   *
   * `res.write()` does NOT throw when the peer has gone away. Node's
   * `_http_outgoing` reports the failure asynchronously with
   * `process.nextTick(() => msg.emit("error", err))`, and emitting `'error'` on
   * an EventEmitter with NO listener THROWS. Inside a `nextTick` that throw is
   * an `uncaughtException`, which `installProcessGuards` converts into
   * `process.exit(1)` — so a user closing one tab mid-stream used to terminate
   * the server and abort every OTHER in-flight SSE stream with it.
   *
   * The pre-checks on `res.destroyed` in the loop below cannot close that: the
   * peer can drop between the check and the write. Only a listener can. The
   * codes involved (EPIPE, ECONNRESET, ERR_STREAM_DESTROYED,
   * ERR_STREAM_WRITE_AFTER_END) are already in `CLIENT_DISCONNECT_CODES`, so
   * they classify as benign here and simply end the pipe.
   */
  const onError = (err: unknown): void => {
    if (socketError === null) socketError = err;
    const disconnect = isClientDisconnect(err);
    if (disconnect) clientGone = true;
    console.error(
      `[agent_server] response socket error on ${res.req.method} ${res.req.originalUrl} (${
        disconnect ? "client disconnected" : "server-side socket failure"
      }): ${err instanceof Error ? err.message : String(err)}`,
      !disconnect && err instanceof Error ? err.stack : undefined,
    );
    cancelReader();
  };
  res.on("error", onError);

  /**
   * The `error` listener is removed on the response's own terminal `close`, NOT
   * in the `finally` below.
   *
   * `finally` still has to call `res.end()`, and on a half-broken socket THAT
   * write can fail the same asynchronous way — a `nextTick` emit of `'error'`
   * on `res`. Detaching synchronously in `finally` would put us back in the
   * exact no-listener state described above, and the process would exit(1) on
   * the very path meant to clean up after it. `ServerResponse` always emits
   * `close` once the response is finished or the connection is gone, so
   * deferring to it keeps the guard for the response's whole life and still
   * leaks nothing.
   */
  res.once("close", () => {
    res.removeListener("error", onError);
  });

  /**
   * Wait until the socket has drained (or the peer is gone).
   *
   * `res.write()` returning false means Node has BUFFERED the chunk in memory
   * because the socket cannot take it yet. The old loop discarded that return
   * value, so a slow or stalled client did not slow the reader down at all: the
   * agent produced events as fast as it could and Node queued the entire run in
   * RSS. With a 25mb request ceiling and multimodal streams that is a real
   * exposure, and it is invisible — no error, no log, just memory growth.
   *
   * `close` and `error` resolve the wait as well as `drain`: a peer that
   * vanished mid-write never emits `drain`, and awaiting it alone would hang
   * this loop (and hold the Mastra run open) until the process died.
   */
  const waitForDrain = (): Promise<void> =>
    new Promise<void>((resolve) => {
      const settle = (): void => {
        res.removeListener("drain", settle);
        res.removeListener("close", settle);
        res.removeListener("error", settle);
        resolve();
      };
      res.on("drain", settle);
      res.on("close", settle);
      res.on("error", settle);
    });

  // Logged ONCE per response. Backpressure is normal and self-correcting; a
  // line per stall would flood the log, but zero lines is what made the old
  // unbounded buffering silent.
  let stalled = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (
        clientGone ||
        socketError !== null ||
        res.writableEnded ||
        res.destroyed
      )
        break;
      if (!value) continue;
      const flushed = res.write(Buffer.from(value));
      if (flushed) continue;
      if (!stalled) {
        stalled = true;
        console.warn(
          `[agent_server] client is slower than the agent on ${res.req.method} ${res.req.originalUrl}; ` +
            `pausing the reader until the socket drains instead of buffering the run in memory`,
        );
      }
      // Re-check first: `write` can fail the socket outright, in which case
      // there is nothing left to drain.
      if (
        clientGone ||
        socketError !== null ||
        res.writableEnded ||
        res.destroyed
      )
        break;
      await waitForDrain();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // `socketError !== null` counts as "peer gone" for the purpose of writing:
    // whatever the classification, a response whose socket has already errored
    // cannot carry a terminal frame, and trying would raise a second error.
    const peerGone =
      clientGone ||
      res.destroyed ||
      socketError !== null ||
      isClientDisconnect(err);
    console.error(
      `[agent_server] stream error (${
        peerGone ? "client already disconnected" : "server-side stream failure"
      }): ${message}`,
      err instanceof Error ? err.stack : undefined,
    );
    // Nothing to tell a client that is already gone, and nothing to write to a
    // response that has already ended.
    if (!peerGone && !res.writableEnded) {
      try {
        writeTerminalRunError(res, `stream failed mid-response: ${message}`);
      } catch (writeErr) {
        console.error(
          `[agent_server] failed to write terminal RUN_ERROR: ${
            writeErr instanceof Error ? writeErr.message : String(writeErr)
          }`,
        );
      }
    }
  } finally {
    res.removeListener("close", onClose);
    /**
     * CANCEL UNCONDITIONALLY. Reader cancellation used to be wired ONLY through
     * the `close` listener, and this `finally` removed that listener without
     * cancelling — so every break NOT driven by an already-fired `close` leaked
     * the Mastra run: `res.writableEnded`/`res.destroyed` turning true, a
     * `socketError`, or the `catch` above on a server-side stream failure. In
     * those cases `ReadableStream.cancel` never fired, `streamAgentRun`'s
     * `teardown()` never ran, and the subscription stayed live burning tokens
     * with nobody reading it — the exact leak the `subscription` /
     * `teardownRequested` holder exists to prevent, never triggered by its only
     * caller. After a normal, fully-drained completion this is a no-op.
     */
    cancelReader();
    // `res.end()` while `onError` is still attached — see the deferred-removal
    // comment above; ending a half-broken socket can itself emit `'error'`.
    if (!res.writableEnded && !res.destroyed) res.end();
  }
}

/**
 * Structural check on the parsed POST body before it reaches `agent.run()`.
 *
 * Unchecked, a malformed POST (empty body, `{}`, a JSON array, a missing
 * `messages`) is cast to `RunAgentInput` and fails somewhere deep inside the
 * Mastra adapter with a message that names nothing about the request — a
 * `TypeError` on an undefined property, typically, reported as a 500 "agent run
 * failed". This is deliberately a SHAPE check and not full schema validation:
 * it rejects the payloads that cannot possibly run while staying permissive
 * about the parts of the AG-UI payload the adapter is free to evolve.
 *
 * Returns `null` when the body is acceptable, otherwise the reason to 400 with.
 */
function runAgentInputProblem(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "request body must be a JSON object (a RunAgentInput)";
  }
  const input = body as Record<string, unknown>;
  for (const field of ["threadId", "runId"] as const) {
    const value = input[field];
    if (typeof value !== "string" || value.length === 0) {
      return `RunAgentInput.${field} must be a non-empty string (got ${JSON.stringify(value)})`;
    }
  }
  // `messages`, `tools` and `context` are all REQUIRED arrays in
  // RunAgentInputSchema (only `state`, `forwardedProps`, `parentRunId` and
  // `resume` are optional). Requiring them is not pedantry: a body carrying
  // threadId/runId/messages but no `tools` reaches the adapter and dies on a
  // `.reduce` of undefined, reported as `RUN_ERROR: Cannot read properties of
  // undefined (reading 'reduce')` — a message that names nothing about the
  // request. Verified by replaying such a body against this server.
  for (const field of ["messages", "tools", "context"] as const) {
    if (!Array.isArray(input[field])) {
      return `RunAgentInput.${field} must be an array (got ${
        input[field] === undefined ? "undefined" : typeof input[field]
      })`;
    }
  }
  return null;
}

/**
 * Max JSON body. 25mb so the multimodal demo's base64 image/PDF uploads fit
 * (the frontend caps attachments at 20MB BEFORE base64 expansion, which adds
 * ~33%). Named so the limit that rejects a request is the limit the error
 * message quotes.
 */
const JSON_BODY_LIMIT = "25mb";

/**
 * Attach the persistent `error` listener to EVERY response, before anything can
 * write to one.
 *
 * `pipeWebResponse` already attaches one, and its comment explains why in full.
 * The problem is WHERE it attaches: inside the pipe, which only the streaming
 * path reaches. Three non-streaming writes never get there and carried no
 * listener at all —
 *   - `jsonBodyErrorHandler`'s 413/400 `res.status(...).json(...)`, which runs
 *     before any route handler;
 *   - `expressHandler`'s 400 for a bad `RunAgentInput`, which returns before
 *     `stage` ever reaches `"pipe"`;
 *   - `expressHandler`'s catch-all 500 (and its bare `res.end()`), which is
 *     reached precisely when something already went wrong.
 *
 * The mechanism does not care that these bodies are small. Node reports an
 * outgoing-message write failure ASYNCHRONOUSLY: `onError` schedules a
 * `process.nextTick` that does `msg.emit('error', err)` whenever the response
 * is not already destroyed, and emitting `'error'` on an EventEmitter with NO
 * listener THROWS. Inside a `nextTick` that throw is an `uncaughtException`,
 * and `installProcessGuards` converts an `uncaughtException` into
 * `process.exit(1)`. So a peer half-closing during a 400 could take the whole
 * process down and abort every OTHER in-flight SSE stream with it — the same
 * blast radius the streaming listener exists to prevent, through a door it does
 * not cover.
 *
 * VERIFIED, not assumed: on Node 24 a write that routes through `onError` while
 * `res.destroyed` is false emits `'error'` on `res`, and with no listener that
 * reaches `uncaughtException`; with a listener the process survives.
 *
 * Registered as the FIRST `app.use` so it is in place before the body parser,
 * which is itself one of the writers above. The listener only logs: there is no
 * corrective action to take on a response nobody is reading, and the point is
 * purely that a listener EXISTS so the emit cannot become fatal. A second
 * listener on the streaming path is harmless — `pipeWebResponse` keeps its own
 * because that one also has to cancel the reader.
 *
 * Nothing is removed on close. The listener is bound to the per-request `res`
 * object, so it is collected with the response; there is no cross-request
 * accumulation to leak.
 */
const guardResponseWriteErrors: RequestHandler = (req, res, next) => {
  res.on("error", (err: unknown) => {
    const disconnect = isClientDisconnect(err);
    console.error(
      `[agent_server] response error on ${req.method} ${req.originalUrl} (${
        disconnect ? "client disconnected" : "server-side response failure"
      }): ${err instanceof Error ? err.message : String(err)}`,
      !disconnect && err instanceof Error ? err.stack : undefined,
    );
  });
  next();
};

/**
 * Express error middleware for `express.json()` failures.
 *
 * A body-parser rejection happens BEFORE any route handler runs, so nothing
 * below ever sees it: Express's default finaliser answers with an HTML error
 * page, and the client — which speaks JSON and SSE only — gets an unparseable
 * body with no machine-readable reason. The realistic trigger is the
 * multimodal demo crossing the 25mb ceiling, and "HTML 413" tells the reader
 * neither what the limit is nor how big the payload was.
 */
const jsonBodyErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // Headers already sent: the only correct move is to let Express destroy the
  // connection; a second write would corrupt the in-flight response.
  if (res.headersSent) {
    next(err);
    return;
  }
  // body-parser tags its own failures with `type`; anything else is not ours.
  const type = (err as { type?: unknown }).type;
  const length = req.headers["content-length"] ?? "unknown";

  if (type === "entity.too.large") {
    console.error(
      `[agent_server] rejected oversized body on ${req.method} ${req.originalUrl} ` +
        `(content-length ${String(length)}, limit ${JSON_BODY_LIMIT})`,
    );
    res.status(413).json({
      error: "request body too large",
      message:
        `JSON body exceeds the ${JSON_BODY_LIMIT} limit (content-length: ${String(length)}). ` +
        `Attachments are base64-encoded on the wire, which adds about 33% to the file size.`,
    });
    return;
  }

  if (type === "entity.parse.failed") {
    console.error(
      `[agent_server] rejected unparseable JSON body on ${req.method} ${req.originalUrl}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(400).json({
      error: "invalid JSON body",
      message: `Request body is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
    return;
  }

  if (typeof type === "string") {
    console.error(
      `[agent_server] rejected body on ${req.method} ${req.originalUrl} (${type}): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(400).json({
      error: "invalid request body",
      message: `Body parser rejected the request (${type}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
    return;
  }

  next(err);
};

/**
 * Mount an agent at `path` (and `path/`, so trailing-slash proxies resolve).
 *
 * RETURNS EVERY EXPRESS PATH IT REGISTERED. The startup banner reports mount
 * counts and its accuracy is treated as an invariant in this file, so the count
 * is taken from what was actually registered rather than re-derived by a caller
 * that has to remember the trailing-slash alias exists.
 */
function mountAgent(
  app: Express,
  path: string,
  agentName: string,
  agent: AguiAgent,
): string[] {
  const webHandler = makeWebHandler(agentName, agent);

  const expressHandler = async (
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> => {
    // The old catch reported EVERY failure as "agent run failed" and logged
    // `err.message` only. It covers four structurally different stages, and
    // three of them have nothing to do with the agent run: a header-conversion
    // throw, a CVDIAG-wrapper throw and a piping failure all got the same
    // label, and the stack — the only thing that says WHICH — was discarded.
    // Track the stage so the label and the log are specific.
    let stage: "validate" | "adapt-request" | "invoke" | "pipe" = "validate";
    try {
      const problem = runAgentInputProblem(req.body);
      if (problem !== null) {
        res.status(400).json({
          error: "invalid RunAgentInput",
          message: `POST ${req.originalUrl} (agent "${agentName}"): ${problem}`,
        });
        return;
      }
      const input = req.body as RunAgentInput;

      stage = "adapt-request";
      const webRequest = toWebRequest(req, input);

      stage = "invoke";
      const webResponse = await webHandler(webRequest);

      stage = "pipe";
      await pipeWebResponse(webResponse, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[agent_server] ${agentName} failed during ${stage}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      if (!res.headersSent) {
        res.status(500).json({ error: `agent ${stage} failed`, message });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  };

  app.post(path, expressHandler);
  const registered = [path];
  if (path !== "/") {
    app.post(`${path}/`, expressHandler);
    registered.push(`${path}/`);
  }
  return registered;
}

/**
 * One agent binding served by a dedicated `src/app/api/copilotkit-*` Next.js
 * route.
 *
 * WHY THIS TABLE IS EXPLICIT AND NOT DERIVED
 * The main `/api/copilotkit` route builds its agents from `@/agent-registry`,
 * so this server shares that map by construction. But fifteen OTHER routes
 * each construct their own agents with their OWN `resourceId` — and, for
 * observational-memory, their own adapter OPTIONS. `resourceId` is the Mastra
 * working-memory bucket, so guessing it (e.g. `mastra-<agentId>`) silently
 * moves a demo into a different bucket: the cell still answers, but its memory
 * is not the memory the Next route would have used. For demos whose whole
 * point is state, that is worse than a hard failure.
 *
 * Every row below is transcribed from the corresponding route file and MUST
 * stay byte-identical to it. `agentName` is the key in that route's
 * `CopilotRuntime({ agents })` map — the name the frontend asks for.
 */
interface DemoEndpointBinding {
  /** Next.js route folder under src/app/api (also the path prefix here). */
  endpoint: string;
  /** Key in that route's CopilotRuntime `agents` map. */
  agentName: string;
  /** Mastra registration key. */
  agentId: string;
  /** Working-memory bucket. MUST match the route exactly. */
  resourceId: string;
  /** The route aliases `default` to this agent. */
  isDefault?: boolean;
  /**
   * Adapter surfacing opt-in for Mastra Observational Memory. Exposed ONLY on
   * `getLocalAgents` (plural) — `getLocalAgent` (singular) has no such option,
   * which is exactly why the route uses the plural form. Without it the
   * `data-om-*` chunks are never mapped to AG-UI activity events and the demo
   * runs with OM surfacing off while looking alive.
   */
  observationalMemory?: boolean;
}

const DEMO_ENDPOINT_BINDINGS: readonly DemoEndpointBinding[] = [
  // src/app/api/copilotkit-a2ui-fixed-schema/route.ts
  {
    endpoint: "copilotkit-a2ui-fixed-schema",
    agentName: "a2ui-fixed-schema",
    agentId: "weatherAgent",
    resourceId: "mastra-a2ui-fixed-schema",
    isDefault: true,
  },
  // src/app/api/copilotkit-a2ui-recovery/route.ts
  {
    endpoint: "copilotkit-a2ui-recovery",
    agentName: "a2ui-recovery",
    agentId: "a2uiRecoveryAgent",
    resourceId: "mastra-a2uiRecoveryAgent",
    isDefault: true,
  },
  // src/app/api/copilotkit-agent-config/route.ts
  {
    endpoint: "copilotkit-agent-config",
    agentName: "agent-config-demo",
    agentId: "weatherAgent",
    resourceId: "mastra-agent-config",
    isDefault: true,
  },
  // src/app/api/copilotkit-auth/[[...slug]]/route.ts
  {
    endpoint: "copilotkit-auth",
    agentName: "auth-demo",
    agentId: "weatherAgent",
    resourceId: "mastra-auth-demo",
    isDefault: true,
  },
  // src/app/api/copilotkit-background-agents/route.ts
  {
    endpoint: "copilotkit-background-agents",
    agentName: "background-agents",
    agentId: "backgroundAgentsAgent",
    resourceId: "mastra-background-agents",
    isDefault: true,
  },
  // src/app/api/copilotkit-beautiful-chat/route.ts
  {
    endpoint: "copilotkit-beautiful-chat",
    agentName: "beautiful-chat",
    agentId: "beautifulChatAgent",
    resourceId: "mastra-beautiful-chat",
    isDefault: true,
  },
  // src/app/api/copilotkit-browser-use/route.ts
  {
    endpoint: "copilotkit-browser-use",
    agentName: "browser-use",
    agentId: "browserUseAgent",
    resourceId: "mastra-browser-use",
    isDefault: true,
  },
  // src/app/api/copilotkit-byoc-hashbrown/route.ts (no `default` alias)
  {
    endpoint: "copilotkit-byoc-hashbrown",
    agentName: "byoc-hashbrown-demo",
    agentId: "byocHashbrownAgent",
    resourceId: "mastra-byoc-hashbrown",
  },
  // src/app/api/copilotkit-byoc-json-render/route.ts (no `default` alias)
  {
    endpoint: "copilotkit-byoc-json-render",
    agentName: "byoc_json_render",
    agentId: "weatherAgent",
    resourceId: "mastra-byoc-json-render",
  },
  // src/app/api/copilotkit-declarative-gen-ui/route.ts
  {
    endpoint: "copilotkit-declarative-gen-ui",
    agentName: "declarative-gen-ui",
    agentId: "weatherAgent",
    resourceId: "mastra-declarative-gen-ui",
    isDefault: true,
  },
  // src/app/api/copilotkit-mcp-apps/route.ts — serves TWO agents.
  {
    endpoint: "copilotkit-mcp-apps",
    agentName: "mcp-apps",
    agentId: "mcpAppsAgent",
    resourceId: "mastra-mcp-apps",
    isDefault: true,
  },
  {
    endpoint: "copilotkit-mcp-apps",
    agentName: "headless-complete",
    agentId: "headlessCompleteAgent",
    resourceId: "mastra-headlessCompleteAgent",
  },
  // src/app/api/copilotkit-multimodal/route.ts
  {
    endpoint: "copilotkit-multimodal",
    agentName: "multimodal-demo",
    agentId: "multimodalAgent",
    resourceId: "mastra-multimodal-demo",
    isDefault: true,
  },
  // src/app/api/copilotkit-observational-memory/route.ts — the ONLY binding in
  // the whole integration that passes a non-default adapter option.
  {
    endpoint: "copilotkit-observational-memory",
    agentName: "observational-memory",
    agentId: "observationalMemoryAgent",
    resourceId: "mastra-observationalMemoryAgent",
    isDefault: true,
    observationalMemory: true,
  },
  // src/app/api/copilotkit-ogui/route.ts — serves TWO agents, no `default`.
  {
    endpoint: "copilotkit-ogui",
    agentName: "open-gen-ui",
    agentId: "openGenUiAgent",
    resourceId: "mastra-open-gen-ui",
  },
  {
    endpoint: "copilotkit-ogui",
    agentName: "open-gen-ui-advanced",
    agentId: "openGenUiAdvancedAgent",
    resourceId: "mastra-open-gen-ui-advanced",
  },
  // src/app/api/copilotkit-voice/[[...slug]]/route.ts
  {
    endpoint: "copilotkit-voice",
    agentName: "voice-demo",
    agentId: "weatherAgent",
    resourceId: "mastra-voice-demo",
    isDefault: true,
  },
];

/**
 * Read the working-memory bucket off a built agent.
 *
 * `MastraAgent` carries its `resourceId` as a public field; the registry binds
 * one per agent. We read the REAL value rather than re-deriving it so the
 * collision checks below compare what the agent actually uses, not what we
 * assume it uses.
 *
 * NO FALLBACK. This used to return the caller's GUESS (`mastra-<name>`) when
 * the field was absent, and that guess then fed the collision comparison — so
 * a missing field could make two genuinely-colliding mounts look disjoint, or
 * two disjoint mounts look identical. By this file's own argument (see
 * DEMO_ENDPOINT_BINDINGS), a wrong resourceId is worse than a hard failure: it
 * silently moves a demo's working-memory bucket. A `MastraAgent` always carries
 * the field, so its absence means the adapter's shape changed and every
 * assumption below is void. Throw instead of guessing.
 */
function resourceIdOf(agent: AguiAgent, context: string): string {
  const candidate = (agent as { resourceId?: unknown }).resourceId;
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error(
      `[agent_server] ${context}: agent has no readable "resourceId" (got ${JSON.stringify(candidate)}). ` +
        `The @ag-ui/mastra agent shape likely changed. Refusing to boot: guessing a resourceId would ` +
        `silently rebind a demo's working-memory bucket.`,
    );
  }
  return candidate;
}

/**
 * Construct one demo-endpoint binding with EXACTLY the options its route uses.
 *
 * `observationalMemory` lives only on `getLocalAgents` (plural), so a binding
 * that needs it is built the same way the route builds it: call the plural
 * form with the flag and pick the agent out of the returned record by its
 * Mastra registration key. Everything else uses the singular form, matching
 * its route.
 */
function buildEndpointAgent(binding: DemoEndpointBinding): AguiAgent {
  // `=== true`, NOT `!== undefined`. This branch means "the flag is REQUESTED",
  // which is the intent everywhere else in the file. With `!== undefined` an
  // explicit `observationalMemory: false` selected the plural path and then hit
  // the assertion below, where the adapter's `undefined` field is compared
  // against `false` — `undefined !== false`, so a binding that merely opted OUT
  // would refuse to boot.
  if (binding.observationalMemory === true) {
    const localAgents = MastraAgent.getLocalAgents({
      mastra,
      resourceId: binding.resourceId,
      observationalMemory: true,
    });
    const agent = localAgents[binding.agentId];
    if (!agent) {
      throw new Error(
        `getLocalAgents did not return ${binding.agentId} — required for /${binding.endpoint}/${binding.agentName}`,
      );
    }
    // FAIL LOUD if the option did not land. A dropped `observationalMemory`
    // does not break the run — the cell answers normally but never surfaces
    // the `data-om-*` activity events, so it LOOKS alive while behaving
    // differently from the Next.js route. That is the worst failure mode for
    // this demo, so assert it at boot instead of discovering it in a probe.
    // `observationalMemory` is a public field on MastraAgent.
    const applied = (agent as { observationalMemory?: unknown })
      .observationalMemory;
    if (applied !== true) {
      throw new Error(
        `[agent_server] observationalMemory did not apply to ${binding.agentId}: ` +
          `expected true, got ${JSON.stringify(applied)}. ` +
          `The @ag-ui/mastra option surface likely changed — /${binding.endpoint}/${binding.agentName} ` +
          `would silently run with OM surfacing off.`,
      );
    }
    return agent as AguiAgent;
  }

  // NO NULL GUARD — the third copy of the same dead branch removed alongside
  // the two in `agent-registry.ts`; see the note there. `getLocalAgent` is typed
  // `=> AbstractAgent` and ends in `return new MastraAgent(...)`, and the
  // failure it was written for (an agentId Mastra does not register) THROWS
  // instead: `Agent with name <id> not found`, a `MastraError`
  // (`MASTRA_GET_AGENT_BY_NAME_NOT_FOUND`) raised by `Mastra#getAgent`, which
  // already names the id and fails the boot on its own.
  const agent = getLocalAgent({
    mastra,
    agentId: binding.agentId,
    resourceId: binding.resourceId,
  });
  return agent as AguiAgent;
}

/**
 * Flat mount names whose two claimants legitimately disagree on resourceId.
 *
 * The check below is a hard boot ERROR by default: a flat `/<agentName>` that
 * two sources bind to DIFFERENT working-memory buckets is exactly the
 * state-corrupting divergence `DEMO_ENDPOINT_BINDINGS` says is worse than a
 * hard failure, and a `console.warn` at boot is not read.
 *
 * One divergence pre-dates this server and cannot be resolved here: it exists
 * between two Next.js sources of truth, both of which this file only mirrors.
 * Listing it is not a waiver — the entry pins BOTH resourceIds, so if either
 * side changes, or the divergence is fixed, this entry no longer matches and
 * the boot fails until someone updates it. Every unlisted divergence throws.
 */
interface KnownFlatNameDivergence {
  agentName: string;
  /** resourceId the /api/copilotkit registry binds (agent-registry.ts). */
  registryResourceId: string;
  /** resourceId the dedicated route binds (transcribed in the table above). */
  bindingResourceId: string;
  why: string;
}

const KNOWN_FLAT_NAME_DIVERGENCES: readonly KnownFlatNameDivergence[] = [
  {
    agentName: "headless-complete",
    registryResourceId: "mastra-headless-complete",
    bindingResourceId: "mastra-headlessCompleteAgent",
    why:
      "agent-registry.ts gives every demo alias `mastra-<name>`, while " +
      "src/app/api/copilotkit-mcp-apps/route.ts binds the same agent name to " +
      "`mastra-headlessCompleteAgent`. Both are live in the Next.js app today, " +
      "so neither can be changed from this server without moving a bucket. The " +
      "demo page uses runtimeUrl=/api/copilotkit-mcp-apps, i.e. the " +
      "endpoint-scoped mount, which carries the route's bucket; the flat name " +
      "keeps the registry's bucket and is NOT rebound.",
  },
];

/**
 * Assert that every `KNOWN_FLAT_NAME_DIVERGENCES` entry was actually MATCHED
 * during mounting.
 *
 * The list's docstring promises that "if either side changes, OR THE DIVERGENCE
 * IS FIXED, this entry no longer matches and the boot fails until someone
 * updates it". Half of that was true and half was not. The entries are only
 * consulted inside the `else if (taken !== actual)` branch, so a CHANGED
 * resourceId is caught (the `find` misses and the unlisted-divergence throw
 * fires) but a FIXED divergence is not: with `taken === actual` that branch
 * never runs, nothing ever reads the entry, and the boot succeeds with a stale
 * waiver in place. The one case the docstring names explicitly was the one case
 * it did not cover.
 *
 * That matters for the same reason `KNOWN_SHARED_RESOURCE_IDS` tracks
 * consumption: a waiver nobody reads is a waiver nobody re-checks, and it stays
 * armed. Reconcile `headless-complete` between the registry and its route and
 * the entry should DIE — otherwise the next real double-claim on that flat name
 * finds this exemption, downgrades a boot error to a `console.warn`, and one of
 * the two mounts quietly answers out of the wrong working-memory bucket.
 */
function assertFlatDivergencesConsumed(
  consumed: ReadonlySet<KnownFlatNameDivergence>,
): void {
  for (const entry of KNOWN_FLAT_NAME_DIVERGENCES) {
    if (consumed.has(entry)) continue;
    throw new Error(
      `[agent_server] stale KNOWN_FLAT_NAME_DIVERGENCES entry: the divergence on flat name ` +
        `"/${entry.agentName}" no longer exists as listed (expected registry resourceId ` +
        `"${entry.registryResourceId}" vs binding resourceId "${entry.bindingResourceId}", but nothing ` +
        `claimed that name twice with those two buckets this boot). Remove the entry. Leaving it keeps a ` +
        `waiver armed for a collision that is not happening, so the next GENUINE double-claim on ` +
        `"/${entry.agentName}" would be downgraded from a boot error to a console.warn and one mount ` +
        `would answer with the wrong Mastra working-memory bucket.`,
    );
  }
}

/**
 * ResourceIds that more than one mount legitimately shares.
 *
 * Two mounts on one resourceId means two mounts on one Mastra working-memory
 * bucket. `agent-registry.ts` already asserts uniqueness over the agents IT
 * builds; `DEMO_ENDPOINT_BINDINGS` sits outside that assertion, so the union is
 * asserted at boot below. Each entry here pins the EXACT set of mounts allowed
 * to share the id: a new mount joining the group, or a listed mount leaving it,
 * fails the boot rather than quietly widening the exemption.
 */
interface KnownSharedResourceId {
  resourceId: string;
  /** Exactly the mount keys expected to share it. Order-insensitive. */
  mounts: readonly string[];
  why: string;
}

const KNOWN_SHARED_RESOURCE_IDS: readonly KnownSharedResourceId[] = [
  {
    resourceId: "mastra-a2ui-fixed-schema",
    mounts: [
      "a2ui-fixed-schema",
      "/copilotkit-a2ui-fixed-schema/a2ui-fixed-schema",
    ],
    why:
      "One demo reachable two ways: the /api/copilotkit registry alias and its " +
      "dedicated route. Both declare the SAME bucket, so the shared id is the " +
      "consistent outcome, not contamination.",
  },
  {
    resourceId: "mastra-declarative-gen-ui",
    mounts: [
      "declarative-gen-ui",
      "/copilotkit-declarative-gen-ui/declarative-gen-ui",
    ],
    why: "Same shape as a2ui-fixed-schema: one demo, two routes, one bucket.",
  },
  {
    resourceId: "mastra-headlessCompleteAgent",
    mounts: ["headlessCompleteAgent", "/copilotkit-mcp-apps/headless-complete"],
    why:
      "One Mastra agent under two mount NAMES on one bucket, by design: the " +
      "registry exposes the raw local-agent key `headlessCompleteAgent` (bound to " +
      "this id for smoke traffic) and src/app/api/copilotkit-mcp-apps/route.ts " +
      "binds the same agent + the same id under the demo name. Sharing the bucket " +
      "is the POINT — the demo and the smoke path must see one memory. Note this " +
      "is a different pair from the KNOWN_FLAT_NAME_DIVERGENCES entry above, " +
      "which is about the flat `/headless-complete` name resolving to the " +
      "registry alias's separate `mastra-headless-complete` bucket.",
  },
  {
    resourceId: "mastra-agent-config",
    mounts: ["agent-config", "/copilotkit-agent-config/agent-config-demo"],
    why:
      "The agent-config demo under two NAMES: the registry alias `agent-config` " +
      "and the route's `agent-config-demo` (src/app/api/copilotkit-agent-config/" +
      "route.ts). Both already share this bucket in the Next.js app, and the demo " +
      'page uses the route (agent="agent-config-demo"). Mirrored, not introduced, ' +
      "here.",
  },
];

/**
 * Assert that no two mounts share a working-memory bucket, except the pairs
 * explicitly listed above — and that every listed pair still exists exactly as
 * listed, so the allowlist cannot rot into a blanket exemption.
 */
function assertResourceIdUniqueness(
  claims: readonly { mount: string; resourceId: string }[],
): void {
  const byResourceId = new Map<string, string[]>();
  for (const { mount, resourceId } of claims) {
    const mounts = byResourceId.get(resourceId);
    if (mounts) mounts.push(mount);
    else byResourceId.set(resourceId, [mount]);
  }

  const allowed = new Map(
    KNOWN_SHARED_RESOURCE_IDS.map((entry) => [entry.resourceId, entry]),
  );
  const sorted = (values: readonly string[]): string =>
    [...values].sort().join(", ");

  /**
   * Which allowlist entries this boot actually LOOKED AT.
   *
   * The staleness check below only fires when a listed resourceId still has
   * exactly one claimant. An entry whose resourceId stops being claimed
   * ENTIRELY — the last mount renamed, the demo deleted — leaves no key in
   * `byResourceId` at all, so the loop never visits it and the entry survives
   * untouched. That contradicts this list's own promise that "a listed mount
   * leaving it fails the boot rather than quietly widening the exemption", and
   * it is how an allowlist rots into a blanket exemption: the entry sits there
   * until an unrelated, GENUINE collision lands on `mastra-headlessCompleteAgent`
   * or `mastra-agent-config`, finds a waiver waiting for it, boots clean and
   * serves a demo the wrong working memory. Tracking consumption and asserting
   * it after the loop closes the 0-claimant hole the same way the 1-claimant
   * hole is closed.
   */
  const consumed = new Set<string>();

  for (const [resourceId, mounts] of byResourceId) {
    const entry = allowed.get(resourceId);
    if (entry) consumed.add(entry.resourceId);
    if (mounts.length === 1) {
      if (entry) {
        throw new Error(
          `[agent_server] stale KNOWN_SHARED_RESOURCE_IDS entry: "${resourceId}" is no longer shared ` +
            `(only "${mounts[0]}" claims it). Remove the entry.`,
        );
      }
      continue;
    }
    if (!entry) {
      throw new Error(
        `[agent_server] duplicate resourceId "${resourceId}" claimed by ${mounts.length} mounts: ` +
          `${sorted(mounts)}. Those mounts share ONE Mastra working-memory bucket, which is the ` +
          `cross-contamination agent-registry.ts asserts against for the agents it builds. Give each ` +
          `mount its own resourceId, or add a KNOWN_SHARED_RESOURCE_IDS entry explaining why they must ` +
          `share one.`,
      );
    }
    if (sorted(mounts) !== sorted(entry.mounts)) {
      throw new Error(
        `[agent_server] KNOWN_SHARED_RESOURCE_IDS entry for "${resourceId}" is out of date: ` +
          `expected mounts [${sorted(entry.mounts)}], found [${sorted(mounts)}].`,
      );
    }
  }

  // EVERY entry must have been consumed. An unconsumed one is a waiver for a
  // resourceId nothing claims any more — see the `consumed` comment above.
  for (const entry of KNOWN_SHARED_RESOURCE_IDS) {
    if (consumed.has(entry.resourceId)) continue;
    throw new Error(
      `[agent_server] stale KNOWN_SHARED_RESOURCE_IDS entry: nothing in this process claims resourceId ` +
        `"${entry.resourceId}" any more (the entry expected mounts [${sorted(entry.mounts)}]). Remove the ` +
        `entry. Leaving it turns a pinned, explained exemption into a blanket one: the next GENUINE ` +
        `collision on that resourceId would find a waiver waiting for it, boot clean, and serve a demo ` +
        `the wrong Mastra working-memory bucket.`,
    );
  }
}

/**
 * Process-level last-resort handlers.
 *
 * Without these, anything escaping the streaming path exits with Node's own
 * message and stack: no `[agent_server]` prefix, so in a container that also
 * runs Next.js the line is indistinguishable from a Next.js crash, and the
 * entrypoint watchdog reports a dead port with no attribution.
 *
 * THE TWO HANDLERS ARE NOT SYMMETRIC, AND THAT IS THE POINT.
 *
 * `unhandledRejection` LOGS AND CONTINUES. It used to `process.exit(1)`, and
 * that was strictly worse than the failure it was written to report — it is the
 * same mistake `pipeWebResponse`'s `onError` comment argues against, one door
 * further along. This is a multi-tenant SSE server: at any moment N clients hold
 * N committed, streaming HTTP 200 responses. A rejection belongs to exactly ONE
 * of them, but `process.exit(1)` aborts all N — every other stream dies
 * mid-frame, with no terminal RUN_ERROR, and every one of those clients
 * misreads a truncated stream as a model or prompt failure. One request's bug
 * is not evidence that the other N are unsafe to finish.
 *
 * And the trigger is ordinary, not exotic. NOT for the reason this comment used
 * to give: it argued from Express 4, which does not route a rejected async
 * handler to error middleware — but this app pins `express: ^5.1.0` (5.2.1
 * installed), and Express 5 DOES forward a rejected async handler to the error
 * middleware. So a rejection thrown out of `expressHandler` is not the shape to
 * worry about here.
 *
 * The real trigger is the ASYNCHRONOUS SOCKET WRITE, which no `catch` and no
 * error middleware can see. `expressHandler`'s own catch checks
 * `res.headersSent` and then calls `res.status(500).json(...)`; if the peer
 * half-closed in between, that write does not throw — Node reports it later
 * with a `process.nextTick` emit (see `pipeWebResponse`'s `onError` comment).
 * The same holds for `jsonBodyErrorHandler`'s 4xx bodies and for `res.end()` on
 * a half-broken socket. Under the old `process.exit(1)` guard, one user closing
 * one tab dropped every concurrent stream.
 *
 * `uncaughtException` still exits. There the process state genuinely may be
 * corrupt (a torn invariant, a half-mutated module), so continuing to serve is
 * the unsafe option and the container restart is the recovery.
 *
 * WHY NOT A GRACEFUL DRAIN INSTEAD (`server.close()` + timeout): a drain is the
 * right answer when the process MUST go down but committed streams deserve
 * their terminal frame. It is the wrong answer here because a per-request
 * rejection does not mean the process must go down at all — draining would
 * still refuse new traffic and end the server over one bad request. The drain
 * shape stays available for `uncaughtException` if a future change wants to
 * soften that one; the asymmetry is the deliberate part.
 */
function installProcessGuards(): void {
  process.on("unhandledRejection", (reason: unknown) => {
    // NOT fatal — see the asymmetry note above. Logged at `error` level with the
    // full stack, because this is still a bug that must be findable: an
    // unhandled rejection means one request failed somewhere no `catch` covered.
    console.error(
      `[agent_server] unhandled promise rejection (ONE request failed; the process keeps serving so ` +
        `other in-flight SSE streams are not aborted): ${
          reason instanceof Error ? reason.message : String(reason)
        }`,
      reason instanceof Error ? reason.stack : undefined,
    );
  });
  process.on("uncaughtException", (err: Error) => {
    console.error(`[agent_server] FATAL: uncaught exception: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}

function main(): void {
  installProcessGuards();
  const app = express();
  // FIRST, before the body parser — the parser's own error responses are one of
  // the unguarded writers this covers. See the comment on the middleware.
  app.use(guardResponseWriteErrors);
  // 25mb so the multimodal demo's base64 image/PDF uploads fit comfortably
  // (the frontend caps attachments at 20MB before base64 expansion).
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  // Registered immediately after the parser, so a body-parser rejection is
  // answered in the SAME `{error, message}` JSON shape every handler below
  // uses. Without it a parse failure never reaches a handler and Express's
  // default finaliser replies with an HTML error page: the multimodal demo
  // crossing the 25mb ceiling gets an HTML 413 that names neither the limit
  // nor the payload, which is not actionable.
  app.use(jsonBodyErrorHandler);

  // Health, registered BEFORE the agent POST routes. Served on BOTH paths:
  //   /health      — the convention every other showcase agent process uses,
  //                  and what the entrypoint watchdog probes.
  //   /api/health  — what Railway's existing healthcheckPath points at today
  //                  (currently answered by the Next.js route of the same
  //                  name). Serving it here too means the healthcheck keeps
  //                  working unchanged when the Next.js half is removed in a
  //                  later phase.
  // Same handler, same body shape as src/app/api/health/route.ts.
  const health = (_req: ExpressRequest, res: ExpressResponse): void => {
    res.json({
      status: "ok",
      integration: "mastra",
      timestamp: new Date().toISOString(),
    });
  };
  app.get("/health", health);
  app.get("/api/health", health);

  // Flat mount name → the resourceId ACTUALLY serving it, so a second claim on
  // the same name can be detected instead of silently winning.
  const flatMounts = new Map<string, string>();
  // Every flat path this process answers, including the root mount. Kept apart
  // from `flatMounts` because that map is keyed by agent NAME (the unit the
  // collision check works in) while this is the list of PATHS — the difference
  // is exactly what made the old count wrong (see the startup log).
  const flatMountPaths: string[] = [];
  // Every endpoint-scoped mount PATH, `/<endpoint>/default` aliases included.
  // `DEMO_ENDPOINT_BINDINGS.length` is NOT this number: 12 of the 17 bindings
  // are `isDefault` and mount a second path, so the old line under-reported the
  // scoped mounts by 12 (17 bindings, 29 scoped paths) and its printed list
  // omitted every alias.
  const scopedMountPaths: string[] = [];
  // Express paths actually registered, which is roughly DOUBLE the mount lists
  // above because `mountAgent` also registers a trailing-slash alias for each.
  let flatExpressPaths = 0;
  let scopedExpressPaths = 0;
  // (mount key → resourceId) for the union uniqueness assertion below. Registry
  // agents are keyed by their flat name, bindings by their endpoint-scoped path,
  // so a message names the thing you would go and edit.
  const resourceIdClaims: { mount: string; resourceId: string }[] = [];
  // Which KNOWN_FLAT_NAME_DIVERGENCES entries this boot actually matched. See
  // `assertFlatDivergencesConsumed` for why an unmatched entry is a boot error.
  const consumedFlatDivergences = new Set<KnownFlatNameDivergence>();

  // 1) The main /api/copilotkit route's agents: the demo aliases plus the
  //    curated local Mastra agents, each already bound to its own resourceId
  //    by the shared registry. Flat names, exactly as the route names them.
  const agents = getAgents();
  for (const [name, agent] of Object.entries(agents)) {
    flatExpressPaths += mountAgent(app, `/${name}`, name, agent).length;
    flatMountPaths.push(`/${name}`);
    const resourceId = resourceIdOf(agent, `registry agent "${name}"`);
    flatMounts.set(name, resourceId);
    resourceIdClaims.push({ mount: name, resourceId });
  }

  // 2) The dedicated /api/copilotkit-* routes. Each binding is mounted
  //    endpoint-scoped at `/<endpoint>/<agentName>` (plus `/<endpoint>/default`
  //    where the route aliases `default`), which is unambiguous even when two
  //    routes give the same agent name different resourceIds.
  for (const binding of DEMO_ENDPOINT_BINDINGS) {
    const agent = buildEndpointAgent(binding);
    const scoped = `/${binding.endpoint}/${binding.agentName}`;
    scopedExpressPaths += mountAgent(
      app,
      scoped,
      binding.agentName,
      agent,
    ).length;
    scopedMountPaths.push(scoped);
    if (binding.isDefault) {
      const aliased = `/${binding.endpoint}/default`;
      scopedExpressPaths += mountAgent(
        app,
        aliased,
        binding.agentName,
        agent,
      ).length;
      scopedMountPaths.push(aliased);
    }

    // The resourceId the agent ACTUALLY carries, not the one the table
    // declares. If the two ever disagree, the builder ignored what we passed
    // and the whole table is fiction — fail before serving a request. "The
    // builder" is whichever form `buildEndpointAgent` picked for this row:
    // `getLocalAgent` (singular) for most rows, but
    // `MastraAgent.getLocalAgents` (plural) for an `observationalMemory` row
    // such as `observational-memory`, since only the plural form takes that
    // option.
    const actual = resourceIdOf(agent, `binding ${scoped}`);
    if (actual !== binding.resourceId) {
      throw new Error(
        `[agent_server] ${scoped}: declared resourceId "${binding.resourceId}" but the built agent ` +
          `carries "${actual}". DEMO_ENDPOINT_BINDINGS must match the route it transcribes; a wrong ` +
          `resourceId silently moves this demo's working-memory bucket.`,
      );
    }
    resourceIdClaims.push({ mount: scoped, resourceId: actual });

    // 3) Also expose a flat `/<agentName>` when that name is free, or when the
    //    name is already taken by an IDENTICAL binding. A flat name already
    //    bound to a DIFFERENT resourceId is NEVER rebound — that would move a
    //    demo's working-memory bucket — and is a boot ERROR, because both sides
    //    of the comparison are now the agents' real resourceIds (the old check
    //    compared a DECLARED value against an ACTUAL one, so it could not tell
    //    a genuine divergence from a bookkeeping mismatch) and because a
    //    `console.warn` about a state-corrupting divergence is not read.
    const taken = flatMounts.get(binding.agentName);
    if (taken === undefined) {
      flatExpressPaths += mountAgent(
        app,
        `/${binding.agentName}`,
        binding.agentName,
        agent,
      ).length;
      flatMountPaths.push(`/${binding.agentName}`);
      flatMounts.set(binding.agentName, actual);
    } else if (taken !== actual) {
      const known = KNOWN_FLAT_NAME_DIVERGENCES.find(
        (entry) =>
          entry.agentName === binding.agentName &&
          entry.registryResourceId === taken &&
          entry.bindingResourceId === actual,
      );
      if (!known) {
        throw new Error(
          `[agent_server] flat name "/${binding.agentName}" is claimed twice with DIFFERENT ` +
            `working-memory buckets: "${taken}" (from the /api/copilotkit registry) and "${actual}" ` +
            `(from the /${binding.endpoint} binding). One of the two mounts would answer with the ` +
            `wrong memory. Reconcile agent-registry.ts with src/app/api/${binding.endpoint}/route.ts, ` +
            `or add a KNOWN_FLAT_NAME_DIVERGENCES entry pinning both ids and saying why.`,
        );
      }
      consumedFlatDivergences.add(known);
      console.warn(
        `[agent_server] known divergence on flat name "/${binding.agentName}": it serves resourceId ` +
          `"${taken}" (from /api/copilotkit); the /${binding.endpoint} binding (resourceId "${actual}") ` +
          `is reachable ONLY at "${scoped}". ${known.why}`,
      );
    }
  }

  // Every mount that claims a working-memory bucket has now been recorded, so
  // the registry's own uniqueness rule can be applied to the UNION — bindings
  // included. `agent-registry.ts` asserts this for the agents it builds, but
  // DEMO_ENDPOINT_BINDINGS is outside that assertion, which is how two mounts
  // ended up on one bucket unnoticed.
  assertResourceIdUniqueness(resourceIdClaims);
  // Both allowlists are asserted the same way, for the same reason: an entry
  // nobody consulted this boot is a waiver that has silently become blanket.
  assertFlatDivergencesConsumed(consumedFlatDivergences);

  // Root: the default showcase agent, mounted LAST so the named sub-paths are
  // matched first by Express's route table. Mirrors strands-typescript.
  flatExpressPaths += mountAgent(
    app,
    "/",
    "agentic_chat",
    agents.agentic_chat,
  ).length;
  flatMountPaths.push("/");

  const server = app.listen(PORT, HOST, () => {
    console.log(
      `[agent_server] mastra AG-UI server listening on ${HOST}:${PORT}`,
    );
    // BOTH numbers come from what `mountAgent` actually registered. Earlier
    // versions counted a proxy for the mounts (`flatMounts`, which the root
    // never joins; `DEMO_ENDPOINT_BINDINGS.length`, which ignores the
    // `/<endpoint>/default` alias each `isDefault` binding also mounts) and each
    // proxy was wrong in its own direction. A diagnostic line whose job is to be
    // trusted cannot be off by one — or, as the scoped line was, off by 12.
    console.log(
      `[agent_server] ${flatMountPaths.length} flat agent mounts (${flatExpressPaths} Express paths, ` +
        `counting the trailing-slash alias registered for each): ${[
          ...flatMountPaths,
        ]
          .sort()
          .join(", ")}`,
    );
    console.log(
      `[agent_server] ${scopedMountPaths.length} endpoint-scoped mounts from ` +
        `${DEMO_ENDPOINT_BINDINGS.length} bindings (${scopedExpressPaths} Express paths, counting ` +
        `trailing-slash aliases): ${[...scopedMountPaths].sort().join(", ")}`,
    );
    console.log(
      `[agent_server] OPENAI_API_KEY: ${
        process.env.OPENAI_API_KEY ? "set" : "NOT SET"
      }`,
    );
  });

  /**
   * Bind failures are EMITTED, not thrown.
   *
   * `app.listen` returns immediately and `EADDRINUSE` / `EACCES` arrive later as
   * an `error` event on the server. With no listener Node turns that into an
   * `uncaughtException` whose message ("listen EADDRINUSE: address already in
   * use 0.0.0.0:8000") names neither this process nor the likeliest cause — the
   * Next.js half of the container already holding the port, which is the exact
   * hazard `DEFAULT_PORT`'s comment is about. Name all three: the bind, the
   * probable cause, the fix.
   */
  server.on("error", (err: NodeJS.ErrnoException) => {
    const cause =
      err.code === "EADDRINUSE"
        ? `Something is already listening on ${HOST}:${PORT}. In this container the likeliest holder is ` +
          `the Next.js process (entrypoint.sh starts BOTH), which binds $PORT. Set AGENT_PORT to a free ` +
          `port, or — once the Next.js half is removed — point the entrypoint at AGENT_PORT=$PORT.`
        : err.code === "EACCES"
          ? `The process may not bind ${HOST}:${PORT}. Ports below 1024 need elevated privileges; pick a ` +
            `port above 1024 via AGENT_PORT.`
          : `Check AGENT_HOST=${JSON.stringify(HOST)} and AGENT_PORT=${PORT} — the address must exist on ` +
            `this host.`;
    console.error(
      `[agent_server] FATAL: cannot listen on ${HOST}:${PORT} (${err.code ?? "no code"}): ${err.message}. ` +
        cause,
    );
    process.exit(1);
  });
}

/**
 * Boot diagnoses are MESSAGES, not stacks.
 *
 * `resourceIdOf`, `buildEndpointAgent`, the declared-vs-actual resourceId check,
 * the flat-name divergence throw and `assertResourceIdUniqueness` all build long
 * messages that name the file to edit and why the boot was refused. Called bare,
 * `main()` let Node print them as `Uncaught Error:` plus a stack frame, folded
 * into Mastra's own boot logging — so the actionable sentence was the hardest
 * part of the output to find. Print the message on its own prefixed line first,
 * then the stack for whoever needs the frame.
 */
try {
  main();
} catch (err) {
  console.error(
    `[agent_server] FATAL: ${err instanceof Error ? err.message : String(err)}`,
  );
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
}

/**
 * Default silence, in seconds, before an SSE response carries a keep-alive
 * comment. Sits under the tightest common proxy idle timeouts (55–60 s) and
 * beside `lockHeartbeatIntervalSeconds`, which shares the unit and default.
 */
export const DEFAULT_SSE_KEEP_ALIVE_INTERVAL_SECONDS = 15;

/**
 * Longest interval the timer can honour. Timers take a signed 32-bit
 * millisecond delay; Node silently replaces anything larger with 1 ms, which
 * would turn a keep-alive into a flood.
 */
export const MAX_SSE_KEEP_ALIVE_INTERVAL_SECONDS = (2 ** 31 - 1) / 1000;

/**
 * Resolves the `sseKeepAliveIntervalSeconds` runtime option once, at
 * construction, so every SSE call site reads one validated value.
 * `undefined` takes the default; `0` disables the keep-alive.
 */
export function resolveSseKeepAliveIntervalSeconds(
  value: number | undefined,
): number {
  const seconds = value ?? DEFAULT_SSE_KEEP_ALIVE_INTERVAL_SECONDS;
  if (
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    seconds > MAX_SSE_KEEP_ALIVE_INTERVAL_SECONDS
  ) {
    throw new RangeError(
      `sseKeepAliveIntervalSeconds must be between 0 and ${MAX_SSE_KEEP_ALIVE_INTERVAL_SECONDS}, got ${String(value)}`,
    );
  }
  return seconds;
}

/**
 * SSE comment frame. Parsers drop comment lines, so no AG-UI event is
 * invented and the verifier, history and middleware never see it.
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html#authoring-notes
 */
const KEEP_ALIVE_FRAME = new TextEncoder().encode(": keep-alive\n\n");

/**
 * Keeps a quiet SSE body open by writing a comment after `idleMs` of silence.
 *
 * Any byte from `source` resets the clock, so an active stream adds nothing
 * to the wire. A back-pressured reader skips the tick instead of queueing
 * frames. The timer stops when the pipe settles, which covers both the source
 * completing and the reader cancelling, on every supported Node version.
 */
export function keepAliveSse(
  source: ReadableStream<Uint8Array>,
  idleMs: number,
): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const arm = (controller: TransformStreamDefaultController<Uint8Array>) => {
    stop();
    timer = setTimeout(() => {
      // `desiredSize` is 1 only while the readable queue is empty; 0 means a
      // slow reader still holds the previous chunk, null means it went away.
      if (controller.desiredSize === 1) controller.enqueue(KEEP_ALIVE_FRAME);
      arm(controller);
    }, idleMs);
    timer.unref?.();
  };
  const transform = new TransformStream<Uint8Array, Uint8Array>(
    {
      start: arm,
      transform(chunk, controller) {
        controller.enqueue(chunk);
        arm(controller);
      },
      flush: stop,
    },
    undefined,
    { highWaterMark: 1 },
  );
  // `flush` stops the timer when the source completes. The pipe settling
  // covers the reader cancelling, on every supported Node version; the source
  // writer surfaces that cancellation to the caller.
  void source
    .pipeTo(transform.writable)
    .catch(() => {})
    .finally(stop);
  return transform.readable;
}

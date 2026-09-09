/**
 * Default silence, in seconds, before an SSE response carries a keep-alive
 * comment. Sits under the tightest common proxy idle timeouts (55–60 s) and
 * beside `lockHeartbeatIntervalSeconds`, which shares the unit and default.
 */
export const DEFAULT_SSE_KEEP_ALIVE_INTERVAL_SECONDS = 15;

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

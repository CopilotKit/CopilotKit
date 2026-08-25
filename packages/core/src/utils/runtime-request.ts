/**
 * How long a runtime-bound request may go without producing RESPONSE HEADERS
 * before its silence is reported as a suspected outage.
 *
 * Everything else in this feature reacts to the OUTCOME of a request. A runtime
 * that accepts the connection and never answers produces no outcome at all, so
 * nothing is reported and no probe is started — and that is the common shape of
 * the failures this feature exists for: a container mid-restart, a half-switched
 * deploy, a dropped tunnel. Only a stopped dev server refuses fast. Measured
 * against the demo before this existed: a server accepting TCP and never
 * writing left System Health reading healthy 35 seconds after the message was
 * sent, with the request still pending.
 *
 * The probe's own bound does not cover this. It bounds a probe; here no probe
 * is ever started.
 *
 * HEADERS, not the body. `fetch` resolves as soon as the response head arrives
 * and the SSE body streams afterwards, so an agent that thinks for a minute
 * still resolves this within milliseconds and is never touched.
 *
 * The watchdog OBSERVES. It never aborts the request, so a runtime that is
 * merely slow still completes the user's run and still reports its eventual
 * outcome.
 *
 * It lives here rather than beside the probe's own bound so that it stays OFF
 * the package index: `core/index.ts` re-exports `agent-registry` wholesale,
 * this module is not re-exported anywhere, and tests reach it by path. Nothing
 * about this number is a promise to anyone outside the package, and tests must
 * derive their waits from it rather than hardcode a number that silently drifts
 * away from this one.
 */
export const RUNTIME_REQUEST_WATCHDOG_MS = 10_000;

/**
 * What a caller can tell the instrumented runtime fetch about ONE request
 * (OSS-904).
 *
 * The connection status is decided by observing request outcomes at a single
 * seam, which by design knows nothing about who issued a request or why. Two
 * facts only the caller has are load-bearing, so they travel with the request:
 * whether its failure means anything at all, and whether an abort came from the
 * caller's own clock rather than from the user.
 *
 * It rides along on `RequestInit`. `fetch` ignores unknown init fields, so this
 * never reaches the wire, and a caller that passes it to a plain `fetch`
 * (memory routes, a customer's own endpoint) simply gets no effect.
 *
 * The object is READ when the request settles, not when it is issued, so a
 * caller may still fill it in afterwards — which is exactly how `timedOut`
 * works, since the caller only learns it timed out after the request is away.
 */
export interface RuntimeRequestMeta {
  /**
   * This request is allowed to fail. Its failure says nothing about the
   * runtime's health, so it must not trigger a confirmation check.
   *
   * For routes the code itself treats as harmless: one thread route is
   * explicitly non-fatal by design, and older runtimes answer optional thread
   * requests with a plain refusal because they do not offer the feature. The
   * confirmation check would already stop these from producing a wrong status
   * — this is about not generating the traffic in the first place.
   *
   * A SUCCESS on such a request still counts. The runtime demonstrably
   * answered, and that is the same evidence any other successful runtime
   * request carries; the destination rule says a success on an optional route
   * restores the status.
   */
  nonCritical?: boolean;
  /**
   * The caller gives up on its own clock, so this request is guaranteed to
   * produce an outcome.
   *
   * That is the whole reason the silence watchdog exists — a request that never
   * settles reports nothing at all — so a request that cannot go silent does
   * not arm one. Arming it anyway would put a second, shorter bound on top of
   * the budget the caller deliberately chose, and would take the caller's own
   * timeout classification (`timedOut` below) out of play.
   *
   * Unlike {@link timedOut}, this is known when the request is ISSUED and is
   * read then.
   */
  selfBounded?: boolean;
  /**
   * The caller aborted this request because ITS OWN timeout fired.
   *
   * A cancellation is excluded from triggering a check because pressing Stop
   * (or unmounting) is not a connectivity problem. A caller giving up on its
   * own clock is the opposite: nothing came back, which is precisely the
   * evidence the status is meant to report. Both arrive as an `AbortError`, so
   * without this flag the timeout is laundered into "the user cancelled" and
   * the outcome is dropped.
   */
  timedOut?: boolean;
}

/** A `RequestInit` carrying {@link RuntimeRequestMeta}. */
export interface RuntimeRequestInit extends RequestInit {
  ɵruntimeRequest?: RuntimeRequestMeta;
}

/** Read the meta a caller attached to a request, if any. */
export function runtimeRequestMeta(
  init?: RequestInit,
): RuntimeRequestMeta | undefined {
  return (init as RuntimeRequestInit | undefined)?.ɵruntimeRequest;
}

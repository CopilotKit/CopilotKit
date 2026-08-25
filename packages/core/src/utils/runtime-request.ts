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

/**
 * How long a runtime-bound request may go without response headers before
 * silence is reported as a suspected outage. Observes only — never aborts.
 */
export const RUNTIME_REQUEST_WATCHDOG_MS = 10_000;

/** Caller-supplied facts for one instrumented runtime request. */
export interface RuntimeRequestMeta {
  /** Failure must not trigger a confirmation check. Success still counts. */
  nonCritical?: boolean;
  /** Caller already bounds this request; do not arm the silence watchdog. */
  selfBounded?: boolean;
  /** Caller aborted on its own timeout, not because the user pressed Stop. */
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

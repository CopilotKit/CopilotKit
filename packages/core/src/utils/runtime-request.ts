export const RUNTIME_REQUEST_WATCHDOG_MS = 10_000;

export interface RuntimeRequestMeta {
  nonCritical?: boolean;
  selfBounded?: boolean;
  timedOut?: boolean;
}

export interface RuntimeRequestInit extends RequestInit {
  ɵruntimeRequest?: RuntimeRequestMeta;
}

export function runtimeRequestMeta(
  init?: RequestInit,
): RuntimeRequestMeta | undefined {
  return (init as RuntimeRequestInit | undefined)?.ɵruntimeRequest;
}

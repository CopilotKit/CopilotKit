/**
 * Typed errors thrown by `DiscoverySource.enumerate` implementations.
 *
 * Why four classes instead of a single generic error? The invoker converts
 * a thrown enumeration error into a single synthetic `state:"error"`
 * ProbeResult — operators then see ONE line in the writer log for an
 * entire failed discovery tick, with no per-target breadcrumbs. Narrowing
 * the error class at the source lets that one line carry the actionable
 * fault class ("RAILWAY_AUTH_FAILED" vs "GHCR 502" vs "DNS refused" vs
 * "upstream schema changed"). Bucketing on class also lets downstream
 * alert rules apply class-specific escalation without parsing error
 * strings.
 *
 * Classes mirror the shape already in use by the orchestrator-level
 * Railway adapter's `orchestrator.RAILWAY_AUTH_FAILED` log ID — auth
 * failures get their own class so an operator can grep by error class
 * across the log stream.
 */

export class DiscoverySourceError extends Error {
  constructor(
    message: string,
    public readonly source: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Credentials rejected by upstream (401 / 403). */
export class DiscoverySourceAuthError extends DiscoverySourceError {
  constructor(source: string, message: string, cause?: unknown) {
    super(message, source, cause);
  }
}

/**
 * Upstream accepted the request but returned a server-side failure
 * (5xx) OR a non-auth 4xx that indicates the backend is misbehaving
 * (404 on a documented path, 429, etc.). Distinct from a transport
 * error — the socket opened and a response came back.
 */
export class DiscoverySourceBackendError extends DiscoverySourceError {
  constructor(
    source: string,
    message: string,
    public readonly status: number,
    cause?: unknown,
  ) {
    super(message, source, cause);
  }
}

/**
 * Network-level failure (DNS, ECONNREFUSED, TLS handshake, request
 * aborted). We never saw an HTTP response. Retryable in nearly every
 * case, but the source surfaces it as an error so the alert engine
 * can see transport-class flakes piling up.
 */
export class DiscoverySourceTransportError extends DiscoverySourceError {
  constructor(source: string, message: string, cause?: unknown) {
    super(message, source, cause);
  }
}

/**
 * Response arrived but doesn't match the expected shape — missing
 * required fields, non-JSON body, Zod rejection of the parsed payload,
 * etc. Indicates an upstream API change; operators should investigate
 * rather than retry.
 */
export class DiscoverySourceSchemaError extends DiscoverySourceError {
  constructor(source: string, message: string, cause?: unknown) {
    super(message, source, cause);
  }
}

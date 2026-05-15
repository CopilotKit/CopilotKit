/**
 * Typed errors thrown by `DiscoverySource.enumerate` implementations.
 *
 * Why five classes instead of a single generic error? The invoker converts
 * a thrown enumeration error into a single synthetic `state:"error"`
 * ProbeResult — operators then see ONE line in the writer log for an
 * entire failed discovery tick, with no per-target breadcrumbs. Narrowing
 * the error class at the source lets that one line carry the actionable
 * fault class ("RAILWAY_AUTH_FAILED" vs "GHCR 502" vs "DNS refused" vs
 * "upstream schema changed" vs "workspace file missing"). Bucketing on
 * class also lets downstream alert rules apply class-specific escalation
 * without parsing error strings.
 *
 * Callers in tests match on class identity (`err instanceof
 * DiscoverySourceSchemaError`) rather than string contents so renames or
 * message tweaks don't silently break the assertion.
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
 * Response or input file arrived but doesn't match the expected shape —
 * missing required fields, non-JSON body, Zod rejection of the parsed
 * payload, malformed YAML, etc. Indicates an upstream API change OR a
 * corrupted input file; operators should investigate rather than retry.
 *
 * `filePath` is set when the error originated from a filesystem-based
 * source (pnpm-packages); `undefined` for network-sourced schema
 * violations where the fault lies in the wire payload.
 */
export class DiscoverySourceSchemaError extends DiscoverySourceError {
  constructor(
    source: string,
    message: string,
    public readonly filePath?: string,
    cause?: unknown,
  ) {
    super(
      filePath !== undefined ? `${message} (file: ${filePath})` : message,
      source,
      cause,
    );
  }
}

/**
 * Thrown when a filesystem-based discovery source cannot reach its input
 * at all — the workspace file is missing, the configured root directory
 * doesn't exist, etc. Kept distinct from SchemaError so operators can
 * tell "file is corrupt" from "file isn't there". The invoker treats
 * both as a failed enumeration (empty input list + logged error), but
 * the log message class differs.
 */
export class DiscoverySourceNotFoundError extends DiscoverySourceError {
  constructor(
    source: string,
    message: string,
    public readonly filePath: string,
    cause?: unknown,
  ) {
    super(`${message} (file: ${filePath})`, source, cause);
  }
}

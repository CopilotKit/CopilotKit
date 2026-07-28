/** Exact identity of one leased delivery attempt. */
export interface DeliveryAttemptRef {
  readonly deliveryId: string;
  readonly attemptCount: number;
  readonly leaseExpiresAt: string;
}

/** Compatibility input for injected/older delivery sources. */
export type DeliveryAttemptInput = DeliveryAttemptRef | string;

/** Safety window reserved for sending the terminal intent before lease expiry. */
export const DELIVERY_LEASE_SAFETY_MARGIN_MS = 10_000;

const ISO_DATETIME_WITH_OFFSET_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

/** Stable in-process key for state that must never bleed across redeliveries. */
export function deliveryAttemptKey(attempt: DeliveryAttemptRef): string {
  return `${attempt.deliveryId}:${attempt.attemptCount}:${attempt.leaseExpiresAt}`;
}

/** Attempt counters are authoritative; lease timestamps never reorder them. */
export function isStrictlyNewerDeliveryAttempt(
  candidate: DeliveryAttemptRef,
  active: DeliveryAttemptRef,
): boolean {
  return (
    candidate.deliveryId === active.deliveryId &&
    candidate.attemptCount > active.attemptCount
  );
}

/** Validate and map the wire claim fields to their handler-facing identity. */
export function deliveryAttemptFromClaim(input: {
  id: string;
  attempt: unknown;
  leaseExpiresAt: unknown;
}): DeliveryAttemptRef {
  if (
    typeof input.attempt !== "number" ||
    !Number.isSafeInteger(input.attempt) ||
    input.attempt <= 0
  ) {
    throw new Error(
      `invalid delivery attempt count for ${input.id}: ${JSON.stringify(input.attempt)}`,
    );
  }
  if (
    typeof input.leaseExpiresAt !== "string" ||
    !ISO_DATETIME_WITH_OFFSET_RE.test(input.leaseExpiresAt) ||
    !Number.isFinite(Date.parse(input.leaseExpiresAt))
  ) {
    throw new Error(
      `invalid delivery lease expiry for ${input.id}: ${JSON.stringify(input.leaseExpiresAt)}`,
    );
  }
  return {
    deliveryId: input.id,
    attemptCount: input.attempt,
    leaseExpiresAt: input.leaseExpiresAt,
  };
}

/**
 * Cap a configured handler deadline so the terminal intent retains a safety
 * window before the attempt lease expires.
 */
export function effectiveDeliveryTimeoutMs(
  configuredTimeoutMs: number,
  attempt: DeliveryAttemptRef,
  nowMs: number,
): number {
  return Math.max(
    0,
    Math.min(
      configuredTimeoutMs,
      Date.parse(attempt.leaseExpiresAt) -
        nowMs -
        DELIVERY_LEASE_SAFETY_MARGIN_MS,
    ),
  );
}

export function isDeliveryAttemptExpired(
  attempt: DeliveryAttemptRef,
  nowMs: number,
): boolean {
  return Date.parse(attempt.leaseExpiresAt) <= nowMs;
}

/**
 * Evict attempt state at expiry even when no later operation touches it.
 * Long leases are re-armed in bounded chunks to avoid setTimeout's 32-bit cap.
 */
export function scheduleDeliveryAttemptExpiry(
  attempt: DeliveryAttemptRef,
  nowMs: () => number,
  onExpire: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let canceled = false;
  const schedule = (): void => {
    if (canceled) return;
    const remaining = Date.parse(attempt.leaseExpiresAt) - nowMs();
    if (remaining <= 0) {
      onExpire();
      return;
    }
    timer = setTimeout(schedule, Math.min(remaining, 2_147_000_000));
    (timer as unknown as { unref?: () => void }).unref?.();
  };
  schedule();
  return () => {
    canceled = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

interface ChannelErrorDetails {
  code?: string;
  message?: string;
  reason?: string;
  retryable?: boolean;
  status?: number;
}

/** Error that preserves app-api/gateway metadata instead of flattening JSON. */
export class ChannelTransportError extends Error {
  readonly code?: string;
  readonly reason?: string;
  readonly retryable?: boolean;
  readonly status?: number;

  constructor(
    message: string,
    options: {
      code?: string;
      reason?: string;
      retryable?: boolean;
      status?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : {});
    this.name = "ChannelTransportError";
    this.code = options.code;
    this.reason = options.reason;
    this.retryable = options.retryable;
    this.status = options.status;
  }
}

function errorDetails(value: unknown): ChannelErrorDetails | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const nested =
    (record["error"] as Record<string, unknown> | undefined) ??
    ((record["payload"] as Record<string, unknown> | undefined)?.["error"] as
      | Record<string, unknown>
      | undefined);
  const candidate = nested ?? record;
  const code =
    typeof candidate["code"] === "string" ? candidate["code"] : undefined;
  const message =
    typeof candidate["message"] === "string" ? candidate["message"] : undefined;
  const reason =
    typeof record["reason"] === "string"
      ? record["reason"]
      : typeof candidate["reason"] === "string"
        ? candidate["reason"]
        : undefined;
  const retryable =
    typeof candidate["retryable"] === "boolean"
      ? candidate["retryable"]
      : undefined;
  const rawStatus = record["status"] ?? candidate["status"];
  const status =
    typeof rawStatus === "number" && Number.isInteger(rawStatus)
      ? rawStatus
      : undefined;
  return code ||
    message ||
    reason ||
    retryable !== undefined ||
    status !== undefined
    ? { code, message, reason, retryable, status }
    : undefined;
}

function isDeterministicGatewayValidationReason(
  reason: string | undefined,
): boolean {
  return (
    reason !== undefined &&
    (/^(?:invalid_|unsafe_json_)/u.test(reason) ||
      reason === "unexpected_keys" ||
      reason === "organization_scope_mismatch" ||
      reason === "runtime_scope_mismatch" ||
      reason === "project_scope_mismatch" ||
      reason === "channel_not_declared")
  );
}

const NON_RETRYABLE_DELIVERY_CODES = new Set([
  "CHANNEL_RENDER_FRAME_CONFLICT",
  "CHANNEL_DELIVERY_RENDER_INCOMPLETE",
  "CHANNEL_DELIVERY_LEASE_INVALID",
  "VALIDATION_ERROR",
]);

/** Preserve structured error fields received over HTTP or Phoenix. */
export function channelTransportError(
  prefix: string,
  reason: unknown,
  status?: number,
): ChannelTransportError {
  const details = errorDetails(reason);
  const deterministic =
    (details?.code !== undefined &&
      NON_RETRYABLE_DELIVERY_CODES.has(details.code)) ||
    isDeterministicGatewayValidationReason(details?.reason);
  const retryable = deterministic ? false : details?.retryable;
  const message = details?.message ?? details?.code ?? details?.reason;
  return new ChannelTransportError(message ? `${prefix}: ${message}` : prefix, {
    ...(details?.code ? { code: details.code } : {}),
    ...(details?.reason ? { reason: details.reason } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
    ...((status ?? details?.status) !== undefined
      ? { status: status ?? details?.status }
      : {}),
    cause: reason,
  });
}

/** Retryability for a failed handler/render operation, kept deliberately narrow. */
export function isRetryableDeliveryError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const value = error as {
      code?: unknown;
      reason?: unknown;
      retryable?: unknown;
    };
    if (
      typeof value.code === "string" &&
      NON_RETRYABLE_DELIVERY_CODES.has(value.code)
    ) {
      return false;
    }
    if (
      typeof value.reason === "string" &&
      isDeterministicGatewayValidationReason(value.reason)
    ) {
      return false;
    }
    if (typeof value.retryable === "boolean") return value.retryable;
  }
  return true;
}

/** A lease-invalid response definitively fences this local attempt. */
export function isDefinitiveAttemptFence(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "CHANNEL_DELIVERY_LEASE_INVALID"
  );
}

export type DeliveryTerminalKind = "complete" | "fail";

export interface AttemptTerminalState {
  terminal?: {
    kind: DeliveryTerminalKind;
    /** First payload's sender; retained so a retry is byte-equivalent. */
    send: () => Promise<void>;
    inFlight?: Promise<void>;
  };
}

/**
 * First terminal kind wins for one exact attempt. Same-kind concurrent calls
 * share the request; transient failure keeps the chosen kind retryable.
 */
export async function runAttemptTerminalIntent(
  state: AttemptTerminalState,
  kind: DeliveryTerminalKind,
  send: () => Promise<void>,
  cleanup: () => void,
  log?: (message: string, meta?: unknown) => void,
): Promise<void> {
  const selected = state.terminal;
  if (selected && selected.kind !== kind) {
    log?.("intelligence terminal intent ignored: opposite kind already won", {
      selected: selected.kind,
      ignored: kind,
    });
    return;
  }
  if (selected?.inFlight) {
    await selected.inFlight;
    return;
  }

  const terminal = selected ?? { kind, send };
  state.terminal = terminal;
  let inFlight!: Promise<void>;
  inFlight = (async () => {
    try {
      await terminal.send();
      cleanup();
    } catch (error) {
      if (isDefinitiveAttemptFence(error)) cleanup();
      throw error;
    } finally {
      if (terminal.inFlight === inFlight) terminal.inFlight = undefined;
    }
  })();
  terminal.inFlight = inFlight;
  await inFlight;
}

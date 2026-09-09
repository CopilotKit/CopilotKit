/**
 * A provider delivery has already reached a terminal outcome.
 *
 * Tool handlers must not convert this error into model-visible tool output:
 * continuing the agent would let later events render through a closed delivery.
 */
const CHANNEL_DELIVERY_TERMINATED = Symbol.for(
  "copilotkit.channels.deliveryTerminated",
);
const CHANNEL_DELIVERY_ERROR_DETAILS = Symbol.for(
  "copilotkit.channels.deliveryErrorDetails",
);

/** Safe provider diagnostics that may cross the canonical AG-UI error path. */
export interface ChannelDeliveryErrorDetails {
  readonly category: "validation";
  readonly provider: "slack" | "teams";
  readonly operation: string;
  readonly effectKind: string;
  readonly providerCode: "invalid_arguments" | "invalid_blocks";
  readonly validationMessages: readonly string[];
  readonly retryable: false;
  readonly deliveryId: string;
}

export interface ChannelDeliveryTerminatedErrorOptions extends ErrorOptions {
  readonly details?: ChannelDeliveryErrorDetails;
}

export class ChannelDeliveryTerminatedError extends Error {
  readonly [CHANNEL_DELIVERY_TERMINATED] = true;
  readonly [CHANNEL_DELIVERY_ERROR_DETAILS]?: ChannelDeliveryErrorDetails;
  readonly details?: ChannelDeliveryErrorDetails;

  constructor(
    message: string,
    options?: ChannelDeliveryTerminatedErrorOptions,
  ) {
    super(message, options);
    this.name = "ChannelDeliveryTerminatedError";
    if (isChannelDeliveryErrorDetails(options?.details)) {
      this.details = options.details;
      this[CHANNEL_DELIVERY_ERROR_DETAILS] = options.details;
    }
  }
}

/**
 * Recognize terminal delivery errors across duplicated package installations.
 */
export function isChannelDeliveryTerminatedError(
  error: unknown,
): error is ChannelDeliveryTerminatedError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { [CHANNEL_DELIVERY_TERMINATED]?: unknown })[
      CHANNEL_DELIVERY_TERMINATED
    ] === true
  );
}

/** Return only diagnostics stamped by the Channel delivery boundary. */
export function channelDeliveryErrorDetails(
  error: unknown,
): ChannelDeliveryErrorDetails | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  return (error as { [CHANNEL_DELIVERY_ERROR_DETAILS]?: unknown })[
    CHANNEL_DELIVERY_ERROR_DETAILS
  ] as ChannelDeliveryErrorDetails | undefined;
}

function isChannelDeliveryErrorDetails(
  value: unknown,
): value is ChannelDeliveryErrorDetails {
  if (typeof value !== "object" || value === null) return false;
  const details = value as Record<string, unknown>;
  const allowed = new Set([
    "category",
    "provider",
    "operation",
    "effectKind",
    "providerCode",
    "validationMessages",
    "retryable",
    "deliveryId",
  ]);
  return (
    Object.keys(details).every((field) => allowed.has(field)) &&
    details.category === "validation" &&
    (details.provider === "slack" || details.provider === "teams") &&
    boundedString(details.operation, 80) &&
    boundedString(details.effectKind, 80) &&
    (details.providerCode === "invalid_arguments" ||
      details.providerCode === "invalid_blocks") &&
    details.retryable === false &&
    boundedString(details.deliveryId, 512) &&
    Array.isArray(details.validationMessages) &&
    details.validationMessages.length <= 5 &&
    details.validationMessages.every(
      (message) =>
        typeof message === "string" &&
        message.length <= 256 &&
        message.startsWith("invalid field at /"),
    )
  );
}

function boundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maxLength
  );
}

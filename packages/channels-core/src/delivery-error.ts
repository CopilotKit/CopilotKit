/**
 * A provider delivery has already reached a terminal outcome.
 *
 * Tool handlers must not convert this error into model-visible tool output:
 * continuing the agent would let later events render through a closed delivery.
 */
const CHANNEL_DELIVERY_TERMINATED = Symbol.for(
  "copilotkit.channels.deliveryTerminated",
);

export class ChannelDeliveryTerminatedError extends Error {
  readonly [CHANNEL_DELIVERY_TERMINATED] = true;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChannelDeliveryTerminatedError";
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

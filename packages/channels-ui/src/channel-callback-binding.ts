/** Runtime marker used to distinguish named callback bindings from plain data. */
const CHANNEL_CALLBACK_BINDING = Symbol.for(
  "copilotkit.channels-ui.channel-callback-binding",
);

/**
 * An opaque request to bind one stable component callback to JSON-safe arguments.
 *
 * The symbol brand is non-enumerable at runtime. Provider serialization therefore
 * sees only `callbackName` and `args`; the Channels engine consumes the binding
 * before it reaches a provider payload.
 */
export interface ChannelCallbackBinding<TArgs = unknown> {
  readonly callbackName: string;
  readonly args: TArgs;
  readonly [CHANNEL_CALLBACK_BINDING]: true;
}

/** Create an opaque named callback binding for a component render. */
export function createChannelCallbackBinding<TArgs>(
  callbackName: string,
  args: TArgs,
): ChannelCallbackBinding<TArgs> {
  if (callbackName.trim().length === 0) {
    throw new TypeError("Channel callback name must not be empty.");
  }
  const binding = { callbackName, args } as ChannelCallbackBinding<TArgs>;
  Object.defineProperty(binding, CHANNEL_CALLBACK_BINDING, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return Object.freeze(binding);
}

/** Return whether `value` is an SDK-created named callback binding. */
export function isChannelCallbackBinding(
  value: unknown,
): value is ChannelCallbackBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<ChannelCallbackBinding>)[CHANNEL_CALLBACK_BINDING] ===
      true &&
    typeof (value as Partial<ChannelCallbackBinding>).callbackName ===
      "string" &&
    "args" in value
  );
}

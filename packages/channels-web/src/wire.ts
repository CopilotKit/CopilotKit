/**
 * Wire contract between the Web adapter (server) and a browser client.
 *
 * This file has no Node or React imports, so both the adapter and the
 * `@copilotkit/channels-web/react` entry can share it.
 */

/** `CUSTOM` event name that carries a posted or updated UI message. */
export const CHANNELS_UI_EVENT = "channels.ui";

/** `CUSTOM` event name that removes a UI message. */
export const CHANNELS_UI_DELETE_EVENT = "channels.ui.delete";

/** `forwardedProps` key that turns a run request into a control click. */
export const CHANNEL_INTERACTION_KEY = "channelInteraction";

/**
 * One serialized UI node. It is a `ChannelNode` with every handler reduced to
 * its minted action id (`ck:…`) and every value that JSON cannot carry
 * (functions, symbols, host React elements) removed.
 */
export interface WebUiNode {
  type: string;
  props: Record<string, unknown> & { children?: WebUiNode[] };
  key?: string | number;
}

/** `value` of a {@link CHANNELS_UI_EVENT} event. */
export interface ChannelsUiEventValue {
  /** Same id as the text message that carries the plain fallback text. */
  messageId: string;
  /** The full UI for this message. Replaces any earlier UI for the id. */
  ir: WebUiNode[];
  /**
   * The plain fallback text of `ir`. A client puts it in the text message
   * with the same id, so the history it sends back matches the latest UI.
   */
  text: string;
}

/** `value` of a {@link CHANNELS_UI_DELETE_EVENT} event. */
export interface ChannelsUiDeleteEventValue {
  messageId: string;
}

/**
 * A control click, sent in `forwardedProps.channelInteraction` of an AG-UI
 * run request.
 */
export interface ChannelInteraction {
  /** The minted action id of the control (its `onClick`/`onSelect`/`onSubmit` prop). */
  id: string;
  /** The button `value`, the chosen select value(s), or the entered text. */
  value?: unknown;
  /** Submitted input id → value. */
  values?: Record<string, unknown>;
  /** The UI message the control lives in, so a handler can update it in place. */
  messageId?: string;
}

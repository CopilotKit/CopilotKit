"use client";

export { ChannelUi } from "./channel-ui.js";
export type { ChannelUiProps, HeadingLevel } from "./channel-ui.js";
export { sendChannelInteraction, useChannelUi } from "./use-channel-ui.js";
export type { ChannelUiMap } from "./use-channel-ui.js";
export {
  CHANNEL_INTERACTION_KEY,
  CHANNELS_UI_DELETE_EVENT,
  CHANNELS_UI_EVENT,
} from "../wire.js";
export type {
  ChannelInteraction,
  ChannelsUiDeleteEventValue,
  ChannelsUiEventValue,
  WebUiNode,
} from "../wire.js";

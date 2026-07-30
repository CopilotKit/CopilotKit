export {
  CHANNEL_SESSION_PROTOCOL,
  PROVIDER_EFFECT_MAX_BYTES,
  assertProviderEffect,
  providerEffectByteLength,
} from "./live-session-contracts.js";
export type { ChannelProviderEffect } from "./live-session-contracts.js";

export {
  connectRealtimeGateway,
  RealtimeGatewaySetupRequiredError,
  RealtimeGatewayUnreachableError,
} from "./realtime-gateway.js";
export type {
  ConnectRealtimeGatewayOptions,
  RealtimeGatewaySession,
  ConnectedRealtimeGatewaySession,
  RealtimeGatewayConnectionState,
} from "./realtime-gateway.js";

export {
  startChannelsOverRealtimeGateway,
  startChannelsWithGatewaySession,
  assertValidChannelRealtimeScope,
} from "./realtime-gateway-launcher.js";
export type {
  ChannelRealtimeScope,
  StartChannelsOverRealtimeGatewayOptions,
  StartChannelsWithGatewaySessionOptions,
} from "./realtime-gateway-launcher.js";

export {
  assertValidChannelNames,
  buildChannelActivationMetadata,
} from "./runtime.js";
export type {
  ChannelsHandle,
  ChannelActivationEnv,
  ChannelActivationMetadata,
} from "./runtime.js";

export { IntelligenceStateStore } from "./intelligence-state-store.js";
export type { IntelligenceStateStoreConfig } from "./intelligence-state-store.js";

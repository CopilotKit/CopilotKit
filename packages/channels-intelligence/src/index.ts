export {
  CHANNEL_DELIVERY_PROTOCOL,
  CHANNEL_DELIVERY_JOIN_TOKEN_TTL_SECONDS,
  CHANNEL_DELIVERY_OWNER_TTL_SECONDS,
  DELIVERY_PACKET_MAX_BYTES,
  assertDeliveryPacket,
  deliveryPacketByteLength,
  deliveryPayloadDigest,
} from "./delivery-contracts.js";
export type {
  ChannelDeliveryPacket,
  ChannelDeliveryPacketAck,
  ChannelDeliveryPayload,
  ChannelProviderPayload,
  ChannelTerminalPayload,
} from "./delivery-contracts.js";

export {
  connectRealtimeGateway,
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
  startChannelsWithGatewayControl,
  assertValidChannelRealtimeScope,
} from "./realtime-gateway-launcher.js";
export type {
  ChannelRealtimeScope,
  StartChannelsOverRealtimeGatewayOptions,
  StartChannelsWithGatewayControlOptions,
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

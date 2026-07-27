// Internal implementation package for Intelligence-delivered Channels.
// The supported consumer surface is the intelligenceAdapter factory and
// IntelligenceAdapterOptions type re-exported from @copilotkit/channels/intelligence.
// Runtime/gateway/bootstrap exports below remain internal integration APIs.

export {
  intelligenceAdapter,
  IntelligenceAdapter,
} from "./intelligence-adapter.js";
export type { IntelligenceAdapterOptions } from "./intelligence-adapter.js";

export { IntelligenceStateStore } from "./intelligence-state-store.js";
export type { IntelligenceStateStoreConfig } from "./intelligence-state-store.js";

export type {
  DeliverySource,
  EgressSink,
  RenderEventSink,
} from "./transports.js";

export type {
  ChannelIngressBase,
  ChannelIngressEnvelope,
  ChannelDeliveryScope,
  EgressOperation,
  EgressOp,
  EgressResult,
  EgressRoute,
  ChannelRenderEvent,
  ChannelRenderEventKind,
  RenderFrame,
  RenderAccepted,
} from "./contracts.js";

export {
  InMemoryDeliverySource,
  InMemoryEgressSink,
  InMemoryRenderEventSink,
} from "./in-memory-transports.js";

// Realtime Gateway transport — the production render/delivery path
// (OSS-402). Undocumented like the rest of the package; exported for the
// Channel-listener bootstrap and tests.
export { RealtimeGatewayTransport } from "./realtime-gateway-transport.js";
export type {
  RealtimeGatewayTransportOptions,
  ChannelRealtimeScope,
} from "./realtime-gateway-transport.js";
export {
  connectRealtimeGateway,
  RealtimeGatewaySetupRequiredError,
} from "./realtime-gateway.js";
export type {
  ConnectRealtimeGatewayOptions,
  RealtimeGatewaySession,
  ConnectedRealtimeGatewaySession,
  RealtimeGatewayConnectionState,
} from "./realtime-gateway.js";
// The Channel-over-Realtime-Gateway launcher (OSS-406): the composition that
// runs a Channel over the realtime path.
export {
  startChannelsOverRealtimeGateway,
  startChannelsWithGatewaySession,
} from "./realtime-gateway-launcher.js";
export type {
  StartChannelsOverRealtimeGatewayOptions,
  StartChannelsWithGatewaySessionOptions,
} from "./realtime-gateway-launcher.js";

// Undocumented fallbacks: the default HTTP transports + config resolver that
// `intelligenceAdapter()` builds when no transports are injected. Not a public
// API (the whole package is `@internal`); exported so consumers and tests can
// reach them directly.
export {
  HttpDeliverySource,
  HttpEgressSink,
  resolveTransportConfig,
} from "./http-transports.js";
export type {
  IntelligenceTransportConfig,
  FetchLike,
} from "./http-transports.js";
export { irToText } from "./ir-to-text.js";

export {
  startChannels,
  assertValidChannelNames,
  buildChannelActivationMetadata,
} from "./runtime.js";
export type {
  ChannelTransport,
  ChannelsHandle,
  StartChannelsOptions,
  ChannelActivationEnv,
  ChannelActivationMetadata,
} from "./runtime.js";

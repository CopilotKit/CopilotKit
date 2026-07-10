// @copilotkit/channels-intelligence — Intelligence-delivered managed-bot adapter for
// @copilotkit/channels. Bridges Intelligence-delivered ingress to bot core and emits
// generic egress operations over injectable transports. Not a publicly
// documented API; consumed by the runtime/managed-listener bootstrap and the
// Intelligence side.

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
  ManagedIngressBase,
  ManagedIngressEnvelope,
  EgressOperation,
  EgressOp,
  EgressResult,
  EgressRoute,
  HostedBotRenderEvent,
  HostedBotRenderEventKind,
  RenderFrame,
  RenderAccepted,
} from "./contracts.js";

export {
  InMemoryDeliverySource,
  InMemoryEgressSink,
  InMemoryRenderEventSink,
} from "./in-memory-transports.js";

// Realtime-gateway (Phoenix) transport — the production render/delivery path
// (OSS-402). Undocumented like the rest of the package; exported for the
// managed-listener bootstrap and tests.
export { PhoenixRealtimeTransport } from "./phoenix-transport.js";
export type {
  PhoenixTransportConfig,
  HostedBotChannel,
  HostedBotRealtimeScope,
} from "./phoenix-transport.js";
export { connectPhoenixHostedBotChannel } from "./phoenix-channel.js";
export type {
  PhoenixConnectConfig,
  ConnectedHostedBotChannel,
} from "./phoenix-channel.js";

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
  startManagedBots,
  assertValidBotNames,
  buildActivationMetadata,
} from "./runtime.js";
export type {
  ManagedTransport,
  ManagedBotsHandle,
  StartManagedBotsOptions,
  ActivationEnv,
  ActivationMetadata,
} from "./runtime.js";

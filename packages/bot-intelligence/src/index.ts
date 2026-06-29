// @copilotkit/bot-intelligence — Intelligence-delivered managed-bot adapter for
// @copilotkit/bot. Bridges Intelligence-delivered ingress to bot core and emits
// generic egress operations over injectable transports. Not a publicly
// documented API; consumed by the runtime/managed-listener bootstrap and the
// Intelligence side.

export {
  intelligenceAdapter,
  IntelligenceAdapter,
} from "./intelligence-adapter.js";
export type { IntelligenceAdapterOptions } from "./intelligence-adapter.js";

export type { DeliverySource, EgressSink } from "./transports.js";

export type {
  ManagedIngressBase,
  ManagedIngressEnvelope,
  EgressOperation,
  EgressOp,
  EgressResult,
  EgressRoute,
} from "./contracts.js";

export {
  InMemoryDeliverySource,
  InMemoryEgressSink,
} from "./in-memory-transports.js";

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

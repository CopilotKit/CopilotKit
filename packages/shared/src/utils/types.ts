import type { AgentCapabilities } from "@ag-ui/core";

export type MaybePromise<T> = T | PromiseLike<T>;

/**
 * More specific utility for records with at least one key
 */
export type NonEmptyRecord<T> =
  T extends Record<string, unknown>
    ? keyof T extends never
      ? never
      : T
    : never;

/**
 * Type representing an agent's basic information
 */
export interface AgentDescription {
  name: string;
  className: string;
  description: string;
  capabilities?: AgentCapabilities;
}

export type RuntimeMode = "sse" | "intelligence";

export const RUNTIME_MODE_SSE = "sse" as const;
export const RUNTIME_MODE_INTELLIGENCE = "intelligence" as const;

export interface IntelligenceRuntimeInfo {
  wsUrl: string;
}

export interface ThreadEndpointRuntimeInfo {
  list: boolean;
  inspect: boolean;
  mutations: boolean;
  realtimeMetadata: boolean;
}

export type RuntimeLicenseStatus =
  | "valid"
  | "none"
  | "expired"
  | "expiring"
  | "invalid"
  | "unknown";

/** Runtime entitlement authority resolved by a managed or self-hosted backend. */
interface RuntimeEntitlement {
  /** Whether the resolved entitlement currently grants product access. */
  active: boolean;
  /** Deployment authority that produced this entitlement. */
  source: "managedOrgSubscription" | "selfHostedDeploymentLicense";
  /** Boolean feature grants keyed by stable feature id. */
  features: Record<string, boolean>;
  /** Numeric limits keyed by stable feature id. */
  limits: Record<string, number>;
  /** Optional catalog plan code supplied by the entitlement authority. */
  planCode?: string;
  /** Optional lower-level source metadata supplied by the authority. */
  entitlementSource?: string;
}

/** Public diagnostic returned when Runtime entitlement resolution is not ready. */
interface RuntimeEntitlementError {
  /** Stable backend or SDK error code. */
  code: string;
  /** Safe human-readable diagnostic. */
  message: string;
  /** Whether a later resolution attempt may succeed without reconfiguration. */
  retryable: boolean;
  /** Optional originating request correlation id. */
  requestId?: string;
  /** Optional originating trace correlation id. */
  traceId?: string;
}

/** Successfully resolved Runtime entitlement response. */
interface RuntimeEntitlementReadyResponse {
  status: "ready";
  entitlement: RuntimeEntitlement;
  error?: never;
}

/** Structured non-ready Runtime entitlement response. */
interface RuntimeEntitlementErrorResponse {
  status: "degraded" | "misconfigured" | "unavailable";
  entitlement?: never;
  error: RuntimeEntitlementError;
}

/** Final structured Runtime entitlement response exposed through `/info`. */
export type RuntimeEntitlementResponse =
  | RuntimeEntitlementReadyResponse
  | RuntimeEntitlementErrorResponse;

export interface A2UIRuntimeInfo {
  enabled: boolean;
  /**
   * Agent ids the runtime applies A2UI to. When omitted, A2UI applies to
   * every agent served by the runtime.
   */
  agents?: string[];
}

export interface RuntimeInfo {
  version: string;
  agents: Record<string, AgentDescription>;
  audioFileTranscriptionEnabled: boolean;
  mode: RuntimeMode;
  intelligence?: IntelligenceRuntimeInfo;
  threadEndpoints?: ThreadEndpointRuntimeInfo;
  /**
   * When true, the runtime exposes POST /agent/:agentId/suggest for stateless
   * suggestion generation. Absent on older runtimes; clients fall back to a
   * client-side agent run.
   */
  suggestions?: boolean;
  /**
   * @deprecated Use `a2ui` instead, which preserves per-agent scoping.
   * Kept for backward compatibility with older clients.
   */
  a2uiEnabled?: boolean;
  a2ui?: A2UIRuntimeInfo;
  openGenerativeUIEnabled?: boolean;
  /** Structured Runtime-level entitlement authority, when advertised. */
  runtimeEntitlements?: RuntimeEntitlementResponse;
  /** Legacy compatibility diagnostic retained for older Core/Inspector clients. */
  licenseStatus?: RuntimeLicenseStatus;
  telemetryDisabled?: boolean;
}

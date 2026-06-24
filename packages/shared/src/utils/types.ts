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
   * @deprecated Use `a2ui` instead, which preserves per-agent scoping.
   * Kept for backward compatibility with older clients.
   */
  a2uiEnabled?: boolean;
  a2ui?: A2UIRuntimeInfo;
  openGenerativeUIEnabled?: boolean;
  licenseStatus?: RuntimeLicenseStatus;
  telemetryDisabled?: boolean;
}

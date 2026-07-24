export * from "./types";
export * from "./utils";
export * from "./constants";
export * from "./telemetry";
export * from "./debug";
export * from "./standard-schema";
export * from "./attachments";

export { logger } from "./logger";
export { finalizeRunEvents } from "./finalize-events";

export {
  TranscriptionErrorCode,
  TranscriptionErrors,
  type TranscriptionErrorResponse,
} from "./transcription-errors";

import * as packageJson from "../package.json";
export const COPILOTKIT_VERSION = packageJson.version;

// Re-export only types from license-verifier (types are erased at compile time,
// so they don't pull in the Node-only `crypto` dependency into client bundles).
// Server-side packages (e.g. @copilotkit/runtime) should import runtime functions
// like createLicenseChecker and getLicenseWarningHeader directly from
// @copilotkit/license-verifier.
export type {
  LicenseChecker,
  LicenseStatus,
  LicensePayload,
  LicenseFeatures,
  LicenseTier,
  LicenseOwner,
} from "@copilotkit/license-verifier";

import type { LicensePayload } from "@copilotkit/license-verifier";
import type {
  RuntimeEntitlementResponse,
  RuntimeLicenseStatus,
} from "./utils/types";

// LicenseContextValue was dropped from license-verifier's public API in
// 0.3.0, so it is defined here. The context shape is owned by this package
// anyway via createLicenseContextValue below.

/**
 * License context value exposed to child components.
 * Frontend providers create their own context using this shape.
 */
export interface LicenseContextValue {
  /** Server-reported license status from the runtime's /info endpoint. Null until known. */
  status: RuntimeLicenseStatus | null;
  /** The license payload if available. Always null on the client; the payload stays server-side. */
  license: LicensePayload | null;
  /** Whether a feature is licensed. Ready entitlements override legacy status behavior. */
  checkFeature: (feature: string) => boolean;
  /** Get a numeric feature limit. Returns null if not applicable. */
  getLimit: (feature: string) => number | null;
}

/**
 * Client-safe license context factory, driven by the license authority the
 * runtime reports via /info.
 *
 * A ready structured entitlement is authoritative. Active entitlements supply
 * feature grants and limits; inactive entitlements deny every feature and
 * limit. Older runtimes that report only a status retain the legacy behavior:
 * features are enabled unless the status is "expired" or "invalid", and no
 * limits are reported. This is inlined here to avoid importing the full
 * license-verifier bundle (which depends on Node's `crypto`) into browser
 * bundles.
 */
export function createLicenseContextValue(
  status: RuntimeLicenseStatus | null | undefined,
  runtimeEntitlements?: RuntimeEntitlementResponse,
): LicenseContextValue {
  const resolvedStatus = status ?? null;
  const featuresEnabled =
    resolvedStatus !== "expired" && resolvedStatus !== "invalid";
  const readyEntitlement =
    runtimeEntitlements?.status === "ready"
      ? runtimeEntitlements.entitlement
      : null;
  const activeEntitlement = readyEntitlement?.active ? readyEntitlement : null;

  return {
    status: resolvedStatus,
    license: null,
    checkFeature: (feature) =>
      readyEntitlement
        ? (activeEntitlement?.features[feature] ?? false)
        : featuresEnabled,
    getLimit: (feature) =>
      activeEntitlement ? (activeEntitlement.limits[feature] ?? null) : null,
  };
}

export {
  A2UI_DEFAULT_GENERATION_GUIDELINES,
  A2UI_DEFAULT_DESIGN_GUIDELINES,
} from "./a2ui-prompts";

export type { DebugEventEnvelope } from "./debug-event-envelope";

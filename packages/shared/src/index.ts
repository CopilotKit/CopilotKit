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
import type { RuntimeLicenseStatus } from "./utils/types";

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
  /** Whether a specific feature is licensed. Returns true if no licensing is active (no token). */
  checkFeature: (feature: string) => boolean;
  /** Get a numeric feature limit. Returns null if not applicable. */
  getLimit: (feature: string) => number | null;
}

/**
 * Client-safe license context factory, driven by the license status the
 * runtime reports via /info.
 *
 * Features are enabled unless the runtime definitively reports the license
 * as "expired" or "invalid". A null/"none"/"unknown" status fails open
 * (unlicensed = unrestricted, with branding), and "expiring" keeps features
 * on while the provider surfaces a warning banner. Per-feature data is not
 * in /info yet, so checkFeature is uniform across features and getLimit has
 * no limits to report. This is inlined here to avoid importing the full
 * license-verifier bundle (which depends on Node's `crypto`) into browser
 * bundles.
 */
export function createLicenseContextValue(
  status: RuntimeLicenseStatus | null | undefined,
): LicenseContextValue {
  const resolvedStatus = status ?? null;
  const featuresEnabled =
    resolvedStatus !== "expired" && resolvedStatus !== "invalid";
  return {
    status: resolvedStatus,
    license: null,
    checkFeature: () => featuresEnabled,
    getLimit: () => null,
  };
}

export {
  A2UI_DEFAULT_GENERATION_GUIDELINES,
  A2UI_DEFAULT_DESIGN_GUIDELINES,
} from "./a2ui-prompts";

export type { DebugEventEnvelope } from "./debug-event-envelope";

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

import type {
  LicenseStatus,
  LicensePayload,
} from "@copilotkit/license-verifier";

// LicenseContextValue and LicenseMode were dropped from license-verifier's
// public API in 0.3.0, so they are defined here. The context shape is owned
// by this package anyway via createLicenseContextValue below.

/**
 * License context value exposed to child components.
 * Frontend providers create their own context using this shape.
 */
export interface LicenseContextValue {
  /** The resolved license status after verification. Null if no token provided. */
  status: LicenseStatus | null;
  /** Convenience: the license payload if valid, null otherwise. */
  license: LicensePayload | null;
  /** Whether a specific feature is licensed. Returns true if no licensing is active (no token). */
  checkFeature: (feature: string) => boolean;
  /** Get a numeric feature limit. Returns null if not applicable. */
  getLimit: (feature: string) => number | null;
}

export type LicenseMode = "online" | "offline";

/**
 * Client-safe license context factory.
 *
 * When status is null (no token provided), all features return true
 * (unlicensed = unrestricted, with branding). This is inlined here to
 * avoid importing the full license-verifier bundle (which depends on
 * Node's `crypto`) into browser bundles.
 */
export function createLicenseContextValue(status: null): {
  status: null;
  license: null;
  checkFeature: (feature: string) => boolean;
  getLimit: (feature: string) => number | null;
} {
  return {
    status: null,
    license: null,
    checkFeature: () => true,
    getLimit: () => null,
  };
}

export {
  A2UI_DEFAULT_GENERATION_GUIDELINES,
  A2UI_DEFAULT_DESIGN_GUIDELINES,
} from "./a2ui-prompts";

export type { DebugEventEnvelope } from "./debug-event-envelope";

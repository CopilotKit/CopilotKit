/**
 * @copilotkit/shared/telemetry stub
 *
 * Client-safe no-op telemetry implementation. This prevents Metro and other
 * bundlers from attempting to resolve @segment/analytics-node (which depends
 * on node:buffer and other Node.js built-ins) when building client bundles.
 *
 * Server-side code should import from @copilotkit/shared/telemetry to get
 * the real implementation.
 */

export { isTelemetryDisabled } from "./telemetry/env-check";

// Re-export all types from telemetry so client code can import them without errors
export type * from "./telemetry/events";
export type { LambdaSendOptions } from "./telemetry/lambda-client";

// No-op lambda client for client environments
export const lambdaClient = {
  async send(_options: any) {
    // no-op
  },
};

export function parseTelemetryIdFromLicense(
  _licenseToken: string,
): string | null {
  return null;
}

export function parseAndWarnTelemetryId(_licenseToken: string): string | null {
  return null;
}

/**
 * No-op TelemetryClient for client environments.
 * All methods are no-ops to prevent runtime errors when telemetry
 * code is accidentally imported in client bundles.
 */
export class TelemetryClient {
  segment: undefined;
  globalProperties: Record<string, any> = {};
  cloudConfiguration: { publicApiKey: string; baseUrl: string } | null = null;
  packageName: string;
  packageVersion: string;

  constructor({
    packageName,
    packageVersion,
  }: {
    packageName: string;
    packageVersion: string;
    telemetryDisabled?: boolean;
    telemetryBaseUrl?: string;
    sampleRate?: number;
  }) {
    this.packageName = packageName;
    this.packageVersion = packageVersion;

    if (typeof window !== "undefined") {
      console.warn(
        "[CopilotKit] TelemetryClient should not be used in client environments. " +
          "This is a no-op stub to prevent bundling errors. " +
          "Server-side code should import from @copilotkit/shared/telemetry.",
      );
    }
  }

  async capture(_event: string, _properties: any) {
    // no-op
  }

  setGlobalProperties(_properties: Record<string, any>) {
    // no-op
  }

  setCloudConfiguration(_properties: {
    publicApiKey: string;
    baseUrl: string;
  }) {
    // no-op
  }

  setLicenseToken(_licenseToken: string) {
    // no-op
  }
}

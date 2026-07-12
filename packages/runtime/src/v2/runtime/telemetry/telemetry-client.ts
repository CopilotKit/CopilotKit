import type { AnalyticsEvents } from "./events";
import { lambdaClient, parseAndWarnTelemetryId } from "@copilotkit/shared";
import * as packageJson from "../../../../package.json";
import { firstNonBlankTelemetryId } from "./telemetry-identity";

export function isTelemetryDisabled(): boolean {
  return (
    (process.env as Record<string, string | undefined>)
      .COPILOTKIT_TELEMETRY_DISABLED === "true" ||
    (process.env as Record<string, string | undefined>)
      .COPILOTKIT_TELEMETRY_DISABLED === "1" ||
    (process.env as Record<string, string | undefined>).DO_NOT_TRACK ===
      "true" ||
    (process.env as Record<string, string | undefined>).DO_NOT_TRACK === "1"
  );
}

export class TelemetryClient {
  private telemetryDisabled: boolean = false;
  // Client-side sampling rate for anonymous events. Identified callers
  // (license token with telemetry_id) bypass the gate. Default 0.05
  // caps anonymous OSS-runtime egress; identified customers send at
  // full fidelity. Override via COPILOTKIT_TELEMETRY_SAMPLE_RATE.
  private sampleRate: number = 0.05;
  // EIP / Intelligence license token (Ed25519-signed JWT). Kept separate
  // from standalone identity so the transport receives only the selected
  // identity source.
  private licenseToken: string | null = null;
  // Effective standalone or license-derived identity used for sampling.
  private telemetryId: string | null = null;

  constructor({
    telemetryDisabled,
    sampleRate,
  }: {
    telemetryDisabled?: boolean;
    sampleRate?: number;
  } = {}) {
    this.telemetryDisabled = telemetryDisabled ?? isTelemetryDisabled();
    this.setSampleRate(sampleRate);
  }

  private shouldSendEvent() {
    if (this.sampleRate >= 1) return true;
    return Math.random() < this.sampleRate;
  }

  /**
   * Atomically replace the process-wide telemetry identity.
   *
   * Standalone identity takes precedence and clears any legacy license token.
   * Passing an empty object clears both sources for anonymous sampling.
   */
  setTelemetryIdentity(identity: {
    telemetryId?: string;
    licenseToken?: string;
  }): void {
    const telemetryId = firstNonBlankTelemetryId(identity.telemetryId);
    if (telemetryId !== undefined) {
      this.telemetryId = telemetryId;
      this.licenseToken = null;
      return;
    }

    this.licenseToken = identity.licenseToken ?? null;
    this.telemetryId = identity.licenseToken
      ? parseAndWarnTelemetryId(identity.licenseToken)
      : null;
  }

  /**
   * Configure legacy license-derived telemetry identity.
   *
   * @deprecated Prefer {@link setTelemetryIdentity} for atomic replacement.
   */
  setLicenseToken(licenseToken: string): void {
    this.setTelemetryIdentity({ licenseToken });
  }

  async capture<K extends keyof AnalyticsEvents>(
    event: K,
    properties: AnalyticsEvents[K],
  ) {
    if (this.telemetryDisabled) return;
    // Anonymous callers are gated by sampleRate; identified callers
    // (telemetry_id present) bypass the gate and always send.
    if (!this.telemetryId && !this.shouldSendEvent()) return;

    await lambdaClient.send({
      event,
      properties: properties as Record<string, unknown>,
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      telemetryId:
        this.licenseToken === null
          ? (this.telemetryId ?? undefined)
          : undefined,
      licenseToken: this.licenseToken ?? undefined,
    });
  }

  private setSampleRate(sampleRate: number | undefined) {
    let _sampleRate: number;

    _sampleRate = sampleRate ?? 0.05;

    if (process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE) {
      _sampleRate = parseFloat(process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE);
    }

    // Number.isNaN guards against parseFloat("nonsense") slipping past the
    // range check (all NaN comparisons are false), which would silently
    // drop every anonymous event with no signal.
    if (Number.isNaN(_sampleRate) || _sampleRate < 0 || _sampleRate > 1) {
      throw new Error("Sample rate must be between 0 and 1");
    }

    this.sampleRate = _sampleRate;
  }
}

const telemetry = new TelemetryClient();
export default telemetry;

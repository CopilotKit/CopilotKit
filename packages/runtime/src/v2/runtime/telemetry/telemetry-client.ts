import type { AnalyticsEvents } from "./events";
import { lambdaClient, parseAndWarnTelemetryId } from "@copilotkit/shared";
import * as packageJson from "../../../../package.json";
import { firstNonBlankTelemetryId } from "./telemetry-identity";

/** Transport identity and sampling authority resolved for one runtime. */
export interface TelemetryIdentity {
  telemetryId?: string;
  licenseToken?: string;
}

/** Capture-only telemetry client bound to one runtime identity. */
export interface TelemetryCapture {
  capture<K extends keyof AnalyticsEvents>(
    event: K,
    properties: AnalyticsEvents[K],
  ): Promise<void>;
}

interface ResolvedTelemetryIdentity {
  telemetryId: string | null;
  licenseToken: string | null;
  licenseTelemetryId: string | null;
}

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
  // Standalone identity sent as a transport claim. It does not grant sampling
  // authority.
  private telemetryId: string | null = null;
  // License-derived identity used only as sampling authority.
  private licenseTelemetryId: string | null = null;

  constructor({
    telemetryDisabled,
    sampleRate,
  }: {
    telemetryDisabled?: boolean;
    sampleRate?: number;
  } = {}) {
    this.telemetryDisabled = telemetryDisabled || isTelemetryDisabled();
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
   * It remains sample-gated; only a license-derived id bypasses sampling.
   * Passing an empty object clears both sources.
   *
   * @param identity - One standalone id, one legacy license token, or neither.
   */
  setTelemetryIdentity(identity: {
    telemetryId?: string;
    licenseToken?: string;
  }): void {
    const resolvedIdentity = this.resolveTelemetryIdentity(identity);
    this.telemetryId = resolvedIdentity.telemetryId;
    this.licenseToken = resolvedIdentity.licenseToken;
    this.licenseTelemetryId = resolvedIdentity.licenseTelemetryId;
  }

  /**
   * Configure legacy license-derived telemetry identity.
   *
   * @deprecated Prefer {@link setTelemetryIdentity} for atomic replacement.
   */
  setLicenseToken(licenseToken: string): void {
    this.setTelemetryIdentity({ licenseToken });
  }

  /**
   * Create an immutable capture scope for one runtime.
   *
   * The scope shares this client's process-wide opt-out and sampling settings,
   * but snapshots transport identity and license-derived sampling authority.
   * Constructing another runtime cannot rewrite an existing scope.
   *
   * @param identity - The runtime's construction-time telemetry identity.
   * @returns A capture-only client bound to that identity.
   */
  createScope(identity: TelemetryIdentity): TelemetryCapture {
    const resolvedIdentity = this.resolveTelemetryIdentity(identity);

    return {
      capture: <K extends keyof AnalyticsEvents>(
        event: K,
        properties: AnalyticsEvents[K],
      ) => this.captureWithIdentity(event, properties, resolvedIdentity),
    };
  }

  async capture<K extends keyof AnalyticsEvents>(
    event: K,
    properties: AnalyticsEvents[K],
  ): Promise<void> {
    return this.captureWithIdentity(event, properties, {
      telemetryId: this.telemetryId,
      licenseToken: this.licenseToken,
      licenseTelemetryId: this.licenseTelemetryId,
    });
  }

  private async captureWithIdentity<K extends keyof AnalyticsEvents>(
    event: K,
    properties: AnalyticsEvents[K],
    identity: ResolvedTelemetryIdentity,
  ): Promise<void> {
    if (this.telemetryDisabled) return;
    // Standalone identity is a transport claim, not sampling authority.
    // Only a legacy license token with telemetry_id bypasses sampleRate.
    if (!identity.licenseTelemetryId && !this.shouldSendEvent()) return;

    // License-authorized events ship at full fidelity. Anonymous and
    // standalone-identified events report the configured sample rate so the
    // sink can extrapolate volume without treating identity as event data.
    const effectiveSampleRate = identity.licenseTelemetryId
      ? 1
      : this.sampleRate;

    await lambdaClient.send({
      event,
      properties: properties as Record<string, unknown>,
      globalProperties: {
        sampleRate: effectiveSampleRate,
        sampleRateAdjustmentFactor: 1 - effectiveSampleRate,
        sampleWeight: 1 / effectiveSampleRate,
      },
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      telemetryId: identity.telemetryId ?? undefined,
      licenseToken: identity.licenseToken ?? undefined,
    });
  }

  private resolveTelemetryIdentity(
    identity: TelemetryIdentity,
  ): ResolvedTelemetryIdentity {
    const telemetryId = firstNonBlankTelemetryId(identity.telemetryId);
    if (telemetryId !== undefined) {
      return {
        telemetryId,
        licenseToken: null,
        licenseTelemetryId: null,
      };
    }

    return {
      telemetryId: null,
      licenseToken: identity.licenseToken ?? null,
      licenseTelemetryId: identity.licenseToken
        ? parseAndWarnTelemetryId(identity.licenseToken)
        : null,
    };
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

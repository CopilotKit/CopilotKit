import type { AnalyticsEvents } from "./events";
import { lambdaClient, parseAndWarnTelemetryId } from "@copilotkit/shared";
import * as packageJson from "../../../../package.json";

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
  // EIP / Intelligence license token (Ed25519-signed JWT). The lambda
  // client decodes its payload to read telemetry_id for the
  // X-CopilotKit-Telemetry-Id header. Set once at runtime construction
  // via setLicenseToken; absent values produce anonymous sends.
  private licenseToken: string | null = null;
  // Parsed telemetry_id from the license-token JWT payload. Cached at
  // setLicenseToken time so `capture()` can branch on identified vs
  // anonymous without re-parsing per event. Null when the token is
  // absent or yielded no telemetry_id.
  private telemetryId: string | null = null;
  // Properties merged into every event this client sends.
  //
  // For facts about the caller that are true for the whole process rather than
  // for one event: which product is embedding the runtime, for instance. A
  // distribution built on top of this can then be told apart in the existing
  // events instead of sending its own, which is the difference between one
  // extra field and a second pipeline nobody asked for.
  //
  // Sent as `global_properties`, a field of its own, so these stay separable
  // from an event's own properties all the way to the sink.
  //
  // Do not reuse a key an event already sets: the fanout spreads this bag last
  // for `oss.runtime.*`, so a collision resolves in favour of the global and
  // does so silently. Names here should describe the caller, not the call.
  private globalProperties: Record<string, unknown> = {};

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
   * Add properties carried by every subsequent event.
   *
   * Merged rather than replaced, so two callers setting different fields do not
   * erase each other. Set once at runtime construction in practice; nothing
   * here is per-request.
   */
  setGlobalProperties(properties: Record<string, unknown>) {
    this.globalProperties = { ...this.globalProperties, ...properties };
  }

  setLicenseToken(licenseToken: string) {
    this.licenseToken = licenseToken;
    this.telemetryId = parseAndWarnTelemetryId(licenseToken);
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
      // Its own field on the wire rather than folded into `properties`, which
      // is what the sink expects: for `oss.runtime.*` the fanout treats
      // `global_properties` as the SDK's pass-through bag and spreads it into
      // the analytics event, and v1's client sends package name and version the
      // same way. Folding it in would work and would put a process-level fact
      // in the per-event slot, where nothing downstream expects to find one.
      globalProperties: this.globalProperties,
      packageName: packageJson.name,
      packageVersion: packageJson.version,
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

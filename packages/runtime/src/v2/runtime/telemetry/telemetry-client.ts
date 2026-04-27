import { AnalyticsEvents } from "./events";
import { lambdaClient } from "@copilotkit/shared";
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
  // Sampling now runs server-side at the telemetry-sink Lambda. The client
  // sends 100% by default; customers who want to cap egress bandwidth can
  // set COPILOTKIT_TELEMETRY_SAMPLE_RATE explicitly.
  private sampleRate: number = 1.0;

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
    if (this.telemetryDisabled) return false;
    if (this.sampleRate >= 1) return true;
    return Math.random() < this.sampleRate;
  }

  async capture<K extends keyof AnalyticsEvents>(
    event: K,
    properties: AnalyticsEvents[K],
  ) {
    if (!this.shouldSendEvent()) return;

    const props = properties as Record<string, unknown>;
    const apiKey =
      typeof props?.["cloud.public_api_key"] === "string"
        ? (props["cloud.public_api_key"] as string)
        : undefined;

    await lambdaClient.send({
      event,
      properties: props,
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      apiKey,
    });
  }

  private setSampleRate(sampleRate: number | undefined) {
    let _sampleRate: number;

    _sampleRate = sampleRate ?? 1.0;

    if (process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE) {
      _sampleRate = parseFloat(process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE);
    }

    if (_sampleRate < 0 || _sampleRate > 1) {
      throw new Error("Sample rate must be between 0 and 1");
    }

    this.sampleRate = _sampleRate;
  }
}

const telemetry = new TelemetryClient();
export default telemetry;

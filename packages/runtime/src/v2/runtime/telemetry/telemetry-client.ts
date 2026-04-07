import { Analytics } from "@segment/analytics-node";
import { AnalyticsEvents } from "./events";
import { flattenObject } from "./utils";
import { v4 as uuidv4 } from "uuid";
import scarfClient from "./scarf-client";

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
  segment: Analytics | undefined;
  globalProperties: Record<string, any> = {};
  private telemetryDisabled: boolean = false;
  private sampleRate: number = 0.05;
  private anonymousId = `anon_${uuidv4()}`;

  constructor({
    telemetryDisabled,
    sampleRate,
  }: {
    telemetryDisabled?: boolean;
    sampleRate?: number;
  } = {}) {
    this.telemetryDisabled = telemetryDisabled ?? isTelemetryDisabled();

    if (this.telemetryDisabled) {
      this.setSampleRate(sampleRate);
      return;
    }

    this.setSampleRate(sampleRate);

    const writeKey =
      process.env.COPILOTKIT_SEGMENT_WRITE_KEY ||
      "n7XAZtQCGS2v1vvBy3LgBCv2h3Y8whja";

    this.segment = new Analytics({
      writeKey,
    });
  }

  private shouldSendEvent() {
    if (this.telemetryDisabled) {
      return false;
    }
    const randomNumber = Math.random();
    return randomNumber < this.sampleRate;
  }

  async capture<K extends keyof AnalyticsEvents>(
    event: K,
    properties: AnalyticsEvents[K],
  ) {
    if (!this.shouldSendEvent()) {
      return;
    }

    const flattenedProperties = flattenObject(properties);
    const propertiesWithGlobal = {
      ...this.globalProperties,
      ...flattenedProperties,
    };
    const orderedPropertiesWithGlobal = Object.keys(propertiesWithGlobal)
      .sort()
      .reduce(
        (obj, key) => {
          obj[key] = propertiesWithGlobal[key];
          return obj;
        },
        {} as Record<string, any>,
      );

    if (this.segment) {
      this.segment.track({
        anonymousId: this.anonymousId,
        event,
        properties: { ...orderedPropertiesWithGlobal },
      });
    }

    await scarfClient.logEvent({
      event,
    });
  }

  setGlobalProperties(properties: Record<string, any>) {
    const flattenedProperties = flattenObject(properties);
    this.globalProperties = {
      ...this.globalProperties,
      ...flattenedProperties,
    };
  }

  private setSampleRate(sampleRate: number | undefined) {
    let _sampleRate: number;

    _sampleRate = sampleRate ?? 0.05;

    if (process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE) {
      _sampleRate = parseFloat(process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE);
    }

    if (_sampleRate < 0 || _sampleRate > 1) {
      throw new Error("Sample rate must be between 0 and 1");
    }

    this.sampleRate = _sampleRate;
    this.setGlobalProperties({
      sampleRate: this.sampleRate,
      sampleRateAdjustmentFactor: 1 - this.sampleRate,
      sampleWeight: 1 / this.sampleRate,
    });
  }
}

const telemetry = new TelemetryClient();
export default telemetry;

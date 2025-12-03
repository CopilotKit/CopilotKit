import { Analytics } from "@segment/analytics-node";
import { AnalyticsEvents } from "./events";
import { flattenObject } from "./utils";
import { v4 as uuidv4 } from "uuid";
import scarfClient from "./scarf-client";

export class TelemetryClient {
  segment: Analytics | undefined;
  globalProperties: Record<string, any> = {};
  cloudConfiguration: { publicApiKey: string; baseUrl: string } | null = null;
  packageName: string;
  packageVersion: string;
  private telemetryDisabled: boolean = false;
  private sampleRate: number = 0.05;
  private anonymousId = `anon_${uuidv4()}`;

  constructor({
    packageName,
    packageVersion,
    telemetryDisabled,
    telemetryBaseUrl,
    sampleRate,
  }: {
    packageName: string;
    packageVersion: string;
    telemetryDisabled?: boolean;
    telemetryBaseUrl?: string;
    sampleRate?: number;
  }) {
    this.packageName = packageName;
    this.packageVersion = packageVersion;
    this.telemetryDisabled =
      telemetryDisabled ||
      (process.env as any).COPILOTKIT_TELEMETRY_DISABLED === "true" ||
      (process.env as any).COPILOTKIT_TELEMETRY_DISABLED === "1" ||
      (process.env as any).DO_NOT_TRACK === "true" ||
      (process.env as any).DO_NOT_TRACK === "1";

    if (this.telemetryDisabled) {
      return;
    }

    this.setSampleRate(sampleRate);

    // eslint-disable-next-line
    const writeKey = process.env.COPILOTKIT_SEGMENT_WRITE_KEY || "n7XAZtQCGS2v1vvBy3LgBCv2h3Y8whja";

    this.segment = new Analytics({
      writeKey,
    });

    this.setGlobalProperties({
      "copilotkit.package.name": packageName,
      "copilotkit.package.version": packageVersion,
    });
  }

  private shouldSendEvent() {
    const randomNumber = Math.random();
    return randomNumber < this.sampleRate;
  }

  async capture<K extends keyof AnalyticsEvents>(event: K, properties: AnalyticsEvents[K]) {
    if (!this.shouldSendEvent() || !this.segment) {
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

    this.segment.track({
      anonymousId: this.anonymousId,
      event,
      properties: { ...orderedPropertiesWithGlobal },
    });

    await scarfClient.logEvent({
      event,
    });
  }

  setGlobalProperties(properties: Record<string, any>) {
    const flattenedProperties = flattenObject(properties);
    this.globalProperties = { ...this.globalProperties, ...flattenedProperties };
  }

  setCloudConfiguration(properties: { publicApiKey: string; baseUrl: string }) {
    this.cloudConfiguration = properties;

    this.setGlobalProperties({
      cloud: {
        publicApiKey: properties.publicApiKey,
        baseUrl: properties.baseUrl,
      },
    });
  }

  private setSampleRate(sampleRate: number | undefined) {
    let _sampleRate: number;

    _sampleRate = sampleRate ?? 0.05;

    // eslint-disable-next-line
    if (process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE) {
      // eslint-disable-next-line
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

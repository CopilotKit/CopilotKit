import { PostHog } from "posthog-node";
import { AnalyticsEvents } from "./events";
import { flattenObject, printSecurityNotice } from "./utils";
import { randomUUID } from "crypto";

export class TelemetryClient {
  posthog: PostHog | undefined;
  globalProperties: Record<string, any> = {};
  cloudConfiguration: { publicApiKey: string; baseUrl: string } | null = null;
  packageName: string;
  packageVersion: string;
  private telemetryDisabled: boolean = false;
  private telemetryBaseUrl: string | undefined;
  private sampleRate: number = 0.05;

  constructor({
    packageName,
    packageVersion,
    telemetryDisabled,
    telemetryBaseUrl,
    posthogToken,
    sampleRate,
  }: {
    packageName: string;
    packageVersion: string;
    telemetryDisabled?: boolean;
    telemetryBaseUrl?: string;
    posthogToken?: string;
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

    this.telemetryBaseUrl =
      telemetryBaseUrl ||
      (process.env as any).COPILOTKIT_TELEMETRY_BASE_URL ||
      "https://telemetry.copilotkit.ai";

    this.posthog = new PostHog(posthogToken || "token", {
      host: `${this.telemetryBaseUrl}/telemetry/ingest`,
    });

    this.setGlobalProperties({
      "copilotkit.package.name": packageName,
      "copilotkit.package.version": packageVersion,
    });
  }

  private shouldSendEvent() {
    if (!this.telemetryBaseUrl) {
      return false;
    }

    const randomNumber = Math.random();
    return randomNumber < this.sampleRate;
  }

  async capture<K extends keyof AnalyticsEvents>(event: K, properties: AnalyticsEvents[K]) {
    if (!this.shouldSendEvent() || !this.posthog) {
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

    this.posthog.capture({
      distinctId: randomUUID(),
      event,
      properties: { ...orderedPropertiesWithGlobal },
    });
  }

  async checkForUpdates() {
    const url = `${this.telemetryBaseUrl}/check-for-updates?packageName=${this.packageName}&packageVersion=${this.packageVersion}`;

    const response = await fetch(url);

    if (!response.ok) {
      return;
    }

    const result = await response.json();
    const { advisory, severity } = result;

    if (!advisory && (severity === "low" || severity === "none")) {
      return;
    }

    printSecurityNotice(result);
  }

  setTelemetryBaseUrl(url: string) {
    this.telemetryBaseUrl = url;

    if (this.posthog) {
      this.posthog.host = `${url}/telemetry/ingest`;
    }
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
    });
  }
}

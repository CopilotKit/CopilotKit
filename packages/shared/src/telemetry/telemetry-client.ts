import { Analytics } from "@segment/analytics-node";
import type { AnalyticsEvents } from "./events";
import { flattenObject } from "./utils";
import { v4 as uuidv4 } from "uuid";
import lambdaClient, { parseTelemetryIdFromLicense } from "./lambda-client";

/**
 * Checks if telemetry is disabled via environment variables.
 * Users can opt out by setting:
 * - COPILOTKIT_TELEMETRY_DISABLED=true or COPILOTKIT_TELEMETRY_DISABLED=1
 * - DO_NOT_TRACK=true or DO_NOT_TRACK=1
 */
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
  cloudConfiguration: { publicApiKey: string; baseUrl: string } | null = null;
  // EIP / Intelligence license token (Ed25519-signed JWT). The lambda
  // client decodes its payload to extract telemetry_id. Customer API
  // keys are NOT used here — they flow only into Segment.
  private licenseToken: string | null = null;
  // Parsed telemetry_id from the license-token JWT payload. Cached at
  // setLicenseToken time so `capture()` can branch on identified vs
  // anonymous without re-parsing per event. Null when the token is
  // absent or yielded no telemetry_id.
  private telemetryId: string | null = null;
  packageName: string;
  packageVersion: string;
  private telemetryDisabled: boolean = false;
  // Client-side sampling rate for anonymous events. Identified events
  // (those whose license token yielded a telemetry_id) bypass the gate
  // entirely. Applied uniformly to both the lambda sink and Segment —
  // one dice roll per capture, both sinks see the same decision.
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
    this.telemetryDisabled = telemetryDisabled || isTelemetryDisabled();

    if (this.telemetryDisabled) {
      return;
    }

    this.setSampleRate(sampleRate);

    // eslint-disable-next-line
    const writeKey =
      process.env.COPILOTKIT_SEGMENT_WRITE_KEY ||
      "n7XAZtQCGS2v1vvBy3LgBCv2h3Y8whja";

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

  async capture<K extends keyof AnalyticsEvents>(
    event: K,
    properties: AnalyticsEvents[K],
  ) {
    if (this.telemetryDisabled) {
      return;
    }

    // Anonymous callers (no telemetry_id) are gated by sampleRate.
    // Identified callers (license token with telemetry_id) always send —
    // the volume is bounded by paying-customer count and full fidelity
    // per identified customer is worth the marginal cost.
    if (!this.telemetryId && !this.shouldSendEvent()) {
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

    await lambdaClient.send({
      event,
      properties: flattenedProperties,
      globalProperties: this.globalProperties,
      packageName: this.packageName,
      packageVersion: this.packageVersion,
      licenseToken: this.licenseToken ?? undefined,
    });

    if (this.segment) {
      this.segment.track({
        anonymousId: this.anonymousId,
        event,
        properties: { ...orderedPropertiesWithGlobal },
      });
    }
  }

  setGlobalProperties(properties: Record<string, any>) {
    const flattenedProperties = flattenObject(properties);
    this.globalProperties = {
      ...this.globalProperties,
      ...flattenedProperties,
    };
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

  // The license token isn't added to globalProperties — we don't want
  // the JWT itself shipped on every event. Only its decoded telemetry_id
  // travels, in the X-CopilotKit-Telemetry-Id header set by lambda-client.
  setLicenseToken(licenseToken: string) {
    this.licenseToken = licenseToken;
    this.telemetryId = parseTelemetryIdFromLicense(licenseToken);
    if (!this.telemetryId) {
      // Smoke signal during the issuer rollout: a token was provided
      // but no telemetry_id came back. Surface it once at configuration
      // time rather than silently degrading to anonymous on every send.
      console.warn(
        "[CopilotKit] License token did not yield a telemetry_id; telemetry events will be sent anonymously.",
      );
    }
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

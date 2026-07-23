import { Analytics } from "@segment/analytics-node";
import type { AnalyticsEvents } from "./events";
import { flattenObject } from "./utils";
import { v4 as uuidv4 } from "uuid";
import {
  firstNonBlankTelemetryId,
  lambdaClient,
  parseAndWarnTelemetryId,
} from "./lambda-client";

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
  // Standalone analytics identity. This stays separate from the effective
  // identity so legacy callers continue sending only their license token to
  // the Lambda transport.
  private telemetryId: string | null = null;
  // License-derived identity used only as sampling authority. A standalone
  // telemetry id remains a transport claim and does not bypass sampleRate.
  private licenseTelemetryId: string | null = null;
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

    // Callers without license-derived sampling authority are gated by
    // sampleRate. Legacy license tokens with telemetry_id always send —
    // the volume is bounded by paying-customer count and full fidelity
    // per identified customer is worth the marginal cost.
    if (!this.licenseTelemetryId && !this.shouldSendEvent()) {
      return;
    }

    // License-authorized events ship at a 100% effective rate. Anonymous and
    // standalone-identified events use sampleRate. Compute per event so
    // downstream weight-based extrapolation stays correct for both groups.
    const effectiveSampleRate = this.licenseTelemetryId ? 1 : this.sampleRate;
    const samplingMeta = {
      sampleRate: effectiveSampleRate,
      sampleRateAdjustmentFactor: 1 - effectiveSampleRate,
      sampleWeight: 1 / effectiveSampleRate,
    };

    const flattenedProperties = flattenObject(properties);
    const propertiesWithGlobal: Record<string, any> = {
      ...this.globalProperties,
      ...samplingMeta,
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
      globalProperties: { ...this.globalProperties, ...samplingMeta },
      packageName: this.packageName,
      packageVersion: this.packageVersion,
      telemetryId: this.telemetryId ?? undefined,
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

  /**
   * Atomically configure standalone, legacy, or anonymous telemetry identity.
   *
   * A standalone id takes transport precedence over a supplied legacy license
   * token, but only a license-derived id grants sampling authority. Neither
   * value is added to event properties.
   *
   * @param identity - One standalone id, one legacy license token, or neither.
   */
  setTelemetryIdentity(identity: {
    telemetryId?: string;
    licenseToken?: string;
  }): void {
    const telemetryId = firstNonBlankTelemetryId(identity.telemetryId);
    if (telemetryId !== undefined) {
      this.telemetryId = telemetryId;
      this.licenseToken = null;
      this.licenseTelemetryId = null;
      return;
    }

    this.telemetryId = null;
    this.licenseToken = identity.licenseToken ?? null;
    this.licenseTelemetryId = identity.licenseToken
      ? parseAndWarnTelemetryId(identity.licenseToken)
      : null;
  }

  /**
   * Configure legacy license-derived telemetry identity.
   *
   * @param licenseToken - License token whose telemetry claim identifies sends.
   */
  setLicenseToken(licenseToken: string) {
    this.setTelemetryIdentity({ licenseToken });
  }

  private setSampleRate(sampleRate: number | undefined) {
    let _sampleRate: number;

    _sampleRate = sampleRate ?? 0.05;

    // eslint-disable-next-line
    if (process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE) {
      // eslint-disable-next-line
      _sampleRate = parseFloat(process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE);
    }

    // Number.isNaN guards against parseFloat("nonsense") slipping past the
    // range check (all NaN comparisons are false), which would silently
    // drop every anonymous event with no signal — especially important
    // since the default is now 0.05, making env-var overrides more common.
    if (Number.isNaN(_sampleRate) || _sampleRate < 0 || _sampleRate > 1) {
      throw new Error("Sample rate must be between 0 and 1");
    }

    this.sampleRate = _sampleRate;
    // Per-event sampling metadata is computed in capture() so only license-
    // authorized events get effectiveSampleRate=1. Standalone transport
    // identity stays in the sampled population.
  }
}

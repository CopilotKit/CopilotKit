import { Analytics } from "@segment/analytics-node";
import type { AnalyticsEvents } from "./events";
import { flattenObject } from "./utils";
import { v4 as uuidv4 } from "uuid";
import {
  firstNonBlankTelemetryId,
  lambdaClient,
  parseAndWarnTelemetryId,
} from "./lambda-client";
import {
  computeSamplingMeta,
  TELEMETRY_EMITTER_V1,
  TELEMETRY_SURFACE_V1,
  UNSAMPLED_RATE,
} from "./sampling";
import { isTelemetryDisabled } from "./telemetry-disabled";

export { isTelemetryDisabled };

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
  // telemetry id remains a transport claim and does not bypass the
  // Segment gate.
  private licenseTelemetryId: string | null = null;
  packageName: string;
  packageVersion: string;
  private telemetryDisabled: boolean = false;
  // Client-side sampling rate for anonymous events on the Segment wire
  // only. The lambda sink is ours and takes every event; Segment is
  // billed per event, so the anonymous population stays capped there.
  // Identified events (those whose license token yielded a telemetry_id)
  // bypass the gate on both wires.
  private segmentSampleRate: number = 0.05;
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
    // Anonymous sampling rate for the Segment wire. Named without the
    // prefix for backward compatibility; the lambda sink ignores it.
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

  private shouldSendToSegment() {
    const randomNumber = Math.random();
    return randomNumber < this.segmentSampleRate;
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
    if (this.telemetryDisabled) {
      return;
    }

    // The two wires are gated separately. The lambda sink takes every
    // event: it is CopilotKit-owned, so anonymous volume costs nothing
    // per event there and a real count beats one extrapolated from 5% of
    // the population. Segment is billed per event, so it keeps the gate —
    // callers without license-derived sampling authority are dropped from
    // that copy at segmentSampleRate. Legacy license tokens with a
    // telemetry_id send on both wires: the volume is bounded by
    // paying-customer count and full fidelity per identified customer is
    // worth the marginal cost.
    const sendToSegment =
      Boolean(identity.licenseTelemetryId) || this.shouldSendToSegment();

    // Sampling metadata is computed in ./sampling so this client and the
    // v2 runtime client can't drift apart again — see the note there.
    // One call per wire, because the two wires were gated differently and
    // a shared block would overweight the lambda copy by 1/sampleRate.
    const lambdaSamplingMeta = computeSamplingMeta({
      telemetryId: identity.licenseTelemetryId,
      sampleRate: UNSAMPLED_RATE,
    });
    const segmentSamplingMeta = computeSamplingMeta({
      telemetryId: identity.licenseTelemetryId,
      sampleRate: this.segmentSampleRate,
    });

    // Everything below travels identically on both copies of this event.
    // The event id is what makes the dual-write dedupable downstream:
    // one capture() produces one id, stamped on the lambda copy and the
    // Segment copy alike, so consumers no longer have to infer the
    // duplication from $lib or from which fields happen to be present
    // (OSS-1019).
    const eventMeta = {
      telemetry_emitter: TELEMETRY_EMITTER_V1,
      telemetry_surface: TELEMETRY_SURFACE_V1,
      telemetry_event_id: uuidv4(),
    };

    const flattenedProperties = flattenObject(properties);
    const propertiesWithGlobal: Record<string, any> = {
      ...this.globalProperties,
      ...eventMeta,
      ...segmentSamplingMeta,
      telemetry_transport: "segment",
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
      globalProperties: {
        ...this.globalProperties,
        ...eventMeta,
        ...lambdaSamplingMeta,
        telemetry_transport: "lambda",
      },
      packageName: this.packageName,
      packageVersion: this.packageVersion,
      telemetryId: identity.telemetryId ?? undefined,
      licenseToken: identity.licenseToken ?? undefined,
    });

    if (this.segment && sendToSegment) {
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
    const resolvedIdentity = this.resolveTelemetryIdentity(identity);
    this.telemetryId = resolvedIdentity.telemetryId;
    this.licenseToken = resolvedIdentity.licenseToken;
    this.licenseTelemetryId = resolvedIdentity.licenseTelemetryId;
  }

  /**
   * Configure legacy license-derived telemetry identity.
   *
   * @param licenseToken - License token whose telemetry claim identifies sends.
   */
  setLicenseToken(licenseToken: string) {
    this.setTelemetryIdentity({ licenseToken });
  }

  /**
   * Create an immutable capture scope for one runtime.
   *
   * The scope shares this client's sinks, process-wide opt-out, global
   * properties, and Segment sampling rate, but snapshots transport identity and
   * license-derived sampling authority. Constructing another runtime cannot
   * rewrite an existing scope.
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

    // eslint-disable-next-line
    if (process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE) {
      // eslint-disable-next-line
      _sampleRate = parseFloat(process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE);
    }

    // Number.isNaN guards against parseFloat("nonsense") slipping past the
    // range check (all NaN comparisons are false), which would silently
    // drop every anonymous Segment event with no signal.
    if (Number.isNaN(_sampleRate) || _sampleRate < 0 || _sampleRate > 1) {
      throw new Error("Sample rate must be between 0 and 1");
    }

    this.segmentSampleRate = _sampleRate;
    // Per-event sampling metadata (sampleRate/sampleRateAdjustmentFactor/
    // sampleWeight) is computed per capture() in ./sampling, once per
    // wire. Only license-authorized events get effectiveSampleRate=1 on
    // the Segment copy; standalone transport identity stays in the
    // sampled population there. The lambda copy is always unsampled.
  }
}

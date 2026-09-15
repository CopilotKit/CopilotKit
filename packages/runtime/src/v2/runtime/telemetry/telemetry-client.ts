import type { AnalyticsEvents } from "./events";
import {
  lambdaClient,
  parseAndWarnTelemetryId,
  computeSamplingMeta,
  TELEMETRY_EMITTER_V2,
  TELEMETRY_SURFACE_V2,
  UNSAMPLED_RATE,
} from "@copilotkit/shared";
import type { TelemetrySurface } from "@copilotkit/shared";
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
  // EIP / Intelligence license token (Ed25519-signed JWT). Kept separate
  // from standalone identity so the transport receives only the selected
  // identity source.
  private licenseToken: string | null = null;
  // Standalone identity sent as a transport claim. It does not make an
  // event identified.
  private telemetryId: string | null = null;
  // License-derived identity. This client sends every event either way;
  // the id is what sets telemetry_identified on the sampling block, which
  // is how the two populations stay separable downstream.
  private licenseTelemetryId: string | null = null;
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
  }: {
    telemetryDisabled?: boolean;
  } = {}) {
    this.telemetryDisabled = telemetryDisabled || isTelemetryDisabled();
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

  /** Atomically replace the process-wide telemetry identity. */
  setTelemetryIdentity(identity: TelemetryIdentity): void {
    const resolvedIdentity = this.resolveTelemetryIdentity(identity);
    this.telemetryId = resolvedIdentity.telemetryId;
    this.licenseToken = resolvedIdentity.licenseToken;
    this.licenseTelemetryId = resolvedIdentity.licenseTelemetryId;
  }

  /** @deprecated Prefer {@link setTelemetryIdentity}. */
  setLicenseToken(licenseToken: string): void {
    this.setTelemetryIdentity({ licenseToken });
  }

  /**
   * Create an immutable capture scope for one Runtime instance.
   *
   * `surface` is the API the developer built against, not the code that
   * emits the event. It is a parameter because this client is also what
   * the deprecated v1 entrypoint delegates to: a v1 request reaches this
   * client through the V2 runtime the v1 shim constructs, and reporting
   * that as v2 traffic would put a share of v1 usage in the v2 column.
   *
   * @param identity - The runtime's construction-time telemetry identity.
   * @param surface - The caller's API surface. Defaults to v2.
   */
  createScope(
    identity: TelemetryIdentity,
    surface: TelemetrySurface = TELEMETRY_SURFACE_V2,
  ): TelemetryCapture {
    const resolvedIdentity = this.resolveTelemetryIdentity(identity);
    return {
      capture: <K extends keyof AnalyticsEvents>(
        event: K,
        properties: AnalyticsEvents[K],
      ) =>
        this.captureWithIdentity(event, properties, resolvedIdentity, surface),
    };
  }

  async capture<K extends keyof AnalyticsEvents>(
    event: K,
    properties: AnalyticsEvents[K],
  ): Promise<void> {
    return this.captureWithIdentity(
      event,
      properties,
      {
        telemetryId: this.telemetryId,
        licenseToken: this.licenseToken,
        licenseTelemetryId: this.licenseTelemetryId,
      },
      TELEMETRY_SURFACE_V2,
    );
  }

  private async captureWithIdentity<K extends keyof AnalyticsEvents>(
    event: K,
    properties: AnalyticsEvents[K],
    identity: ResolvedTelemetryIdentity,
    surface: TelemetrySurface,
  ): Promise<void> {
    if (this.telemetryDisabled) return;

    await lambdaClient.send({
      event,
      properties: properties as Record<string, unknown>,
      // Its own field on the wire rather than folded into `properties`, which
      // is what the sink expects: for `oss.runtime.*` the fanout treats
      // `global_properties` as the SDK's pass-through bag and spreads it into
      // the analytics event, and v1's client sends package name and version the
      // same way. Folding it in would work and would put a process-level fact
      // in the per-event slot, where nothing downstream expects to find one.
      // Sampling metadata rides in the same slot, as it does in v1. This
      // client has one wire and does not sample it, so the block is
      // constant — it is stamped anyway because a consumer summing
      // sampleWeight across emitters must not find the field missing on
      // a quarter of the rows, which is the state that made ~24% of
      // runtime volume unweightable before (OSS-1017).
      globalProperties: {
        ...this.globalProperties,
        ...computeSamplingMeta({
          telemetryId: identity.licenseTelemetryId,
          sampleRate: UNSAMPLED_RATE,
        }),
        telemetry_emitter: TELEMETRY_EMITTER_V2,
        telemetry_surface: surface,
        // This client has one transport, so the marker is constant here. It
        // is stamped anyway so the property means the same thing on every
        // event whichever client produced it (OSS-1019).
        telemetry_transport: "lambda",
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
}

const telemetry = new TelemetryClient();
export default telemetry;

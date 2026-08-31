// Telemetry sink client.
//
// Posts events to a CopilotKit-controlled telemetry-sink endpoint, which
// fans out to Scarf, Reo, and any future destinations. Replaces the direct
// per-vendor calls (scarf-client.ts) so that vendor changes don't require
// SDK releases and so that downstream services we don't want exposed to
// OSS readers (e.g. the email-enrichment service backing Reo) stay
// private.
//
// Two attribution modes:
//   - Identified: a CopilotKit license token is configured. The token is
//     a JWT (header.payload.sig) whose payload carries `telemetry_id`.
//     The SDK base64url-decodes the payload — without verifying the
//     Ed25519 signature, which is the license-verifier's job — and
//     emits the id via `X-CopilotKit-Telemetry-Id`. The Lambda uses it
//     to enrich events with the customer's email.
//   - Anonymous: no license token, or a malformed/non-JWT one. No
//     telemetry-id header; events still flow, attribution is best-effort
//     from request-level signals (IP, UA).
//
// Note: CopilotCloud customer API keys (`ck_<env>_<id>.<secret>`) are
// unrelated to telemetry attribution. They flow into Segment / PostHog
// via the v1 shared TelemetryClient and never reach this code path.
//
// Best-effort: every error is swallowed. Telemetry must not break the
// host application.

const TELEMETRY_SINK_URL =
  (typeof process !== "undefined" && process.env?.COPILOTKIT_TELEMETRY_URL) ||
  "https://telemetry.copilotkit.ai/ingest";

const FETCH_TIMEOUT_MS = 3000;

export interface LambdaSendOptions {
  event: string;
  properties?: Record<string, unknown>;
  globalProperties?: Record<string, unknown>;
  packageName?: string;
  packageVersion?: string;
  // The CopilotKit license token (Ed25519-signed JWT), when one is
  // configured on the runtime. The sender base64url-decodes the payload
  // segment to extract `telemetry_id`; missing or malformed tokens
  // produce an anonymous send.
  licenseToken?: string;
}

// These fields aren't used by the telemetry service, so we strip them
// at the wire boundary rather than rely on every caller to omit them.
// Both the snake_case and camelCase variants are listed because callers
// upstream use different conventions.
const STRIPPED_KEYS = new Set(["cloud.public_api_key", "cloud.publicApiKey"]);

function stripCloudKeys(
  obj: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!obj) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!STRIPPED_KEYS.has(k)) out[k] = v;
  }
  return out;
}

// Pull telemetry_id out of a CopilotKit license token without verifying
// the signature. The token shape is a standard JWT
// (`<header>.<payload>.<sig>`) with base64url-encoded segments; the
// payload is JSON with a `telemetry_id` string field.
//
// Verification (Ed25519, key rotation, expiry) is the license-verifier
// package's job. For telemetry attribution we only need the claimed id —
// the trust model is claim-only on the Lambda side anyway.
//
// Exported so TelemetryClient setters can detect unparseable tokens at
// configuration time and surface a single warning, instead of silently
// emitting anonymous events on every capture.
export function parseTelemetryIdFromLicense(token?: string): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padding = (4 - (b64.length % 4)) % 4;
    b64 += "=".repeat(padding);
    const json =
      typeof atob === "function"
        ? atob(b64)
        : Buffer.from(b64, "base64").toString("utf8");
    const decoded = JSON.parse(json) as { telemetry_id?: unknown };
    return typeof decoded.telemetry_id === "string"
      ? decoded.telemetry_id
      : null;
  } catch {
    return null;
  }
}

// Parse the telemetry_id from a license token AND emit the rollout smoke
// signal if the parse returned null. Returning the parsed id lets callers
// cache it in one step (avoiding a second parseTelemetryIdFromLicense
// pass) while keeping the warn text in lockstep between v1 (shared) and
// v2 (runtime) TelemetryClient.setLicenseToken.
export function parseAndWarnTelemetryId(licenseToken: string): string | null {
  const telemetryId = parseTelemetryIdFromLicense(licenseToken);
  if (!telemetryId) {
    console.warn(
      "[CopilotKit] License token did not yield a telemetry_id; telemetry events will be sent anonymously.",
    );
  }
  return telemetryId;
}

export async function send(opts: LambdaSendOptions): Promise<void> {
  try {
    const body = JSON.stringify({
      event: opts.event,
      properties: stripCloudKeys(opts.properties),
      global_properties: stripCloudKeys(opts.globalProperties),
      package: {
        name: opts.packageName,
        version: opts.packageVersion,
      },
      ts: Math.floor(Date.now() / 1000),
    });

    const telemetryId = parseTelemetryIdFromLicense(opts.licenseToken);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": opts.packageName
        ? `CopilotKit-Runtime/${opts.packageVersion ?? "unknown"} (${opts.packageName})`
        : "CopilotKit-Runtime",
    };
    if (telemetryId) {
      headers["X-CopilotKit-Telemetry-Id"] = telemetryId;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      await fetch(TELEMETRY_SINK_URL, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    // Silent failure — telemetry must not break the application.
  }
}

export const lambdaClient = { send };

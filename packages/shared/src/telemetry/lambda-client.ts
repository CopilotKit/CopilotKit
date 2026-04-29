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
//   - Identified: API key parses as `ck_<env>_<id>.<secret>`. Request
//     carries an `X-CopilotKit-Telemetry-Id: <id>` header; the Lambda uses
//     the id to enrich events with the customer's email. The secret half
//     is ignored — the Lambda doesn't verify signatures.
//   - Anonymous: API key absent or unparseable (legacy CopilotCloud keys,
//     OSS-only installs). No telemetry-id header; events still flow,
//     attribution is best-effort from request-level signals (IP, UA).
//
// Best-effort: every error is swallowed. Telemetry must not break the
// host application.

const TELEMETRY_SINK_URL =
  (typeof process !== "undefined" && process.env?.COPILOTKIT_TELEMETRY_URL) ||
  "https://telemetry.copilotkit.ai/ingest";

const FETCH_TIMEOUT_MS = 3000;

// API key format issued by CopilotCloud:
//   ck_<env>_<telemetry_id>.<secret>
// The SDK extracts telemetry_id; the secret is retained in the regex for
// shape-compatibility with existing keys but is no longer used. Older /
// legacy keys do not match this regex and produce an anonymous send.
const API_KEY_REGEX =
  /^ck_(?:live|test)_([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]+)$/;

export interface LambdaSendOptions {
  event: string;
  properties?: Record<string, unknown>;
  globalProperties?: Record<string, unknown>;
  packageName?: string;
  packageVersion?: string;
  // The CopilotCloud API key, when one is configured. The sender
  // attempts to parse it; unparseable keys cause an anonymous send.
  apiKey?: string;
}

function parseTelemetryId(apiKey?: string): string | null {
  if (!apiKey) return null;
  const match = apiKey.match(API_KEY_REGEX);
  if (!match) return null;
  return match[1];
}

export async function send(opts: LambdaSendOptions): Promise<void> {
  try {
    const body = JSON.stringify({
      event: opts.event,
      properties: opts.properties || {},
      global_properties: opts.globalProperties || {},
      package: {
        name: opts.packageName,
        version: opts.packageVersion,
      },
      ts: Math.floor(Date.now() / 1000),
    });

    const telemetryId = parseTelemetryId(opts.apiKey);
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

export default { send };

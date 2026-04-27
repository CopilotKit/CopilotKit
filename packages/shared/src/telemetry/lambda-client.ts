// Telemetry sink client.
//
// Posts events to a CopilotKit-controlled telemetry-sink endpoint, which
// fans out to Scarf, Reo, and any future destinations. Replaces the direct
// per-vendor calls (scarf-client.ts) so that vendor changes don't require
// SDK releases and so that downstream services we don't want exposed to
// OSS readers (e.g. the email-enrichment service backing Reo) stay
// private.
//
// Two send modes:
//   - Signed: API key parses as `ck_<env>_<id>.<secret>`. Request carries
//     an `Authorization: CK1 id=..., ts=..., nonce=..., sig=...` header
//     (HMAC-SHA256 over `ts\nnonce\nsha256(body)`). The Lambda verifies
//     using a KMS-backed master key and enriches events with the
//     identified customer's email.
//   - Unsigned: API key absent or unparseable (legacy CopilotCloud keys,
//     OSS-only installs). Request goes through with no Authorization
//     header; events are still fanned out, just without email enrichment.
//
// Best-effort: every error is swallowed. Telemetry must not break the
// host application.

const TELEMETRY_SINK_URL =
  (typeof process !== "undefined" &&
    process.env?.COPILOTKIT_TELEMETRY_URL) ||
  "https://telemetry.copilotkit.ai/ingest";

const FETCH_TIMEOUT_MS = 3000;

// API key format issued by CopilotCloud:
//   ck_<env>_<telemetry_id>.<secret>
// where env is "live" or "test", telemetry_id is the public half (lookup
// key on the Lambda side), and secret is the per-customer HMAC secret.
// Older / legacy keys do not match this regex and fall through to the
// unsigned send path.
const API_KEY_REGEX =
  /^ck_(?:live|test)_([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]+)$/;

export interface LambdaSendOptions {
  event: string;
  properties?: Record<string, unknown>;
  globalProperties?: Record<string, unknown>;
  packageName?: string;
  packageVersion?: string;
  // The CopilotCloud API key, when one is configured. The sender
  // attempts to parse it; unparseable keys cause an unsigned send.
  apiKey?: string;
}

interface ParsedApiKey {
  telemetryId: string;
  secret: string;
}

function parseApiKey(apiKey?: string): ParsedApiKey | null {
  if (!apiKey) return null;
  const match = apiKey.match(API_KEY_REGEX);
  if (!match) return null;
  return { telemetryId: match[1], secret: match[2] };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  // btoa is available in both Node (>=16) and browsers.
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(binary, "binary").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  // crypto.getRandomValues is available in Node 19+ and all modern
  // browsers / edge runtimes. The shared package targets the same
  // surfaces, so we don't fall back to a weaker source.
  (globalThis as { crypto?: Crypto }).crypto!.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await (globalThis as { crypto?: Crypto }).crypto!.subtle.digest(
    "SHA-256",
    data,
  );
  return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256(
  keyBytes: Uint8Array,
  message: string,
): Promise<Uint8Array> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto!.subtle;
  // The slice is to land on a plain ArrayBuffer (BufferSource), since
  // Uint8Array<ArrayBufferLike> isn't assignable in stricter lib targets.
  const keyBuf = keyBytes.buffer.slice(
    keyBytes.byteOffset,
    keyBytes.byteOffset + keyBytes.byteLength,
  ) as ArrayBuffer;
  const cryptoKey = await subtle.importKey(
    "raw",
    keyBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message),
  );
  return new Uint8Array(signature);
}

async function buildAuthHeader(
  parsed: ParsedApiKey,
  body: string,
): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = randomNonce();
  const bodyHash = await sha256Hex(body);
  const canonical = `${ts}\n${nonce}\n${bodyHash}`;

  const secretBytes = new TextEncoder().encode(parsed.secret);
  const sigBytes = await hmacSha256(secretBytes, canonical);
  const sig = bytesToBase64Url(sigBytes);

  return `CK1 id=${parsed.telemetryId}, ts=${ts}, nonce=${nonce}, sig=${sig}`;
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

    const parsed = parseApiKey(opts.apiKey);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": opts.packageName
        ? `CopilotKit-Runtime/${opts.packageVersion ?? "unknown"} (${opts.packageName})`
        : "CopilotKit-Runtime",
    };
    if (parsed) {
      headers["Authorization"] = await buildAuthHeader(parsed, body);
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

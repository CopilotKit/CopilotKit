import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const SESSION_COOKIE_NAME = "cloudplot_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1_000;

type Environment = Record<string, string | undefined>;

export type RuntimeSecurityConfiguration =
  | { mode: "bypass" }
  | { mode: "misconfigured" }
  | { mode: "protected"; accessCode: string; sessionSecret: string };

export function getRuntimeSecurityConfiguration(
  environment: Environment = process.env,
): RuntimeSecurityConfiguration {
  if (environment.NODE_ENV !== "production") return { mode: "bypass" };
  const accessCode = environment.CLOUDPLOT_ACCESS_CODE?.trim();
  const sessionSecret = environment.CLOUDPLOT_SESSION_SECRET?.trim();
  const hasTrustedClientAddress =
    Boolean(environment.RAILWAY_ENVIRONMENT_ID) ||
    Boolean(environment.CLOUDPLOT_TRUSTED_PROXY_HEADER?.trim());
  if (!accessCode || !sessionSecret || !hasTrustedClientAddress) {
    return { mode: "misconfigured" };
  }
  return { mode: "protected", accessCode, sessionSecret };
}

function equalStrings(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function verifyAccessCode(
  candidate: string,
  configuration: Extract<RuntimeSecurityConfiguration, { mode: "protected" }>,
) {
  return equalStrings(candidate, configuration.accessCode);
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionValue(
  configuration: Extract<RuntimeSecurityConfiguration, { mode: "protected" }>,
  now = Date.now(),
) {
  const expiresAt = String(now + SESSION_TTL_MS);
  return `${expiresAt}.${sign(expiresAt, configuration.sessionSecret)}`;
}

export function verifySessionValue(
  value: string | undefined,
  configuration: Extract<RuntimeSecurityConfiguration, { mode: "protected" }>,
  now = Date.now(),
) {
  if (!value) return false;
  const separator = value.indexOf(".");
  if (separator <= 0) return false;
  const expiresAt = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expiry = Number(expiresAt);
  return (
    Number.isSafeInteger(expiry) &&
    expiry > now &&
    equalStrings(signature, sign(expiresAt, configuration.sessionSecret))
  );
}

interface FixedWindowLimiterOptions {
  limit: number;
  windowMs: number;
  maxKeys: number;
}

interface LimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class FixedWindowLimiter {
  private readonly buckets = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private readonly overflowKey = "__overflow__";

  constructor(private readonly options: FixedWindowLimiterOptions) {}

  get size() {
    return this.buckets.size;
  }

  consume(requestedKey: string, now = Date.now()): LimitResult {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }

    const key =
      this.buckets.has(requestedKey) || this.buckets.size < this.options.maxKeys
        ? requestedKey
        : this.overflowKey;
    const bucket = this.buckets.get(key) ?? {
      count: 0,
      resetAt: now + this.options.windowMs,
    };
    bucket.count += 1;
    this.buckets.set(key, bucket);
    return {
      allowed: bucket.count <= this.options.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
    };
  }
}

export function getClientKey(headers: Headers, railway: boolean) {
  const headerName = railway
    ? "x-real-ip"
    : process.env.CLOUDPLOT_TRUSTED_PROXY_HEADER?.trim();
  if (!headerName) {
    throw new Error(
      "Direct production deployments must configure a trusted client address source.",
    );
  }
  const candidate = headers.get(headerName)?.split(",", 1)[0]?.trim() ?? "";
  if (!isIP(candidate)) {
    throw new Error("The trusted client address header is missing or invalid.");
  }
  return `${railway ? "railway" : "direct"}:${candidate}`;
}

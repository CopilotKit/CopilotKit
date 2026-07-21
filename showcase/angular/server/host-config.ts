import { validateBackendHostPattern } from "./proxy-policy.js";

export interface HostConfig {
  port: number;
  production: boolean;
  backendHostPattern?: string;
  backendConfigStatus: "valid" | "missing" | "invalid";
  frameAncestors: string[];
}

const DEFAULT_STAGING_ANCESTOR = "https://showcase.staging.copilotkit.ai";

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 3000;
  if (!/^\d+$/.test(raw)) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function parseFrameAncestors(raw: string | undefined): string[] {
  const candidates =
    raw === undefined ? [DEFAULT_STAGING_ANCESTOR] : raw.split(/\s+/);
  const ancestors = ["'self'"];
  for (const candidate of candidates) {
    if (!candidate || candidate === "'self'") continue;
    try {
      const parsed = new URL(candidate);
      if (
        parsed.protocol === "https:" &&
        parsed.username === "" &&
        parsed.password === "" &&
        parsed.pathname === "/" &&
        parsed.search === "" &&
        parsed.hash === "" &&
        parsed.origin === candidate &&
        !ancestors.includes(parsed.origin)
      ) {
        ancestors.push(parsed.origin);
      }
    } catch {
      // Invalid ancestors are omitted; diagnostics report only the count.
    }
  }
  return ancestors;
}

/** Normalize environment configuration into presence/status-only diagnostics. */
export function readHostConfig(
  env: Readonly<Record<string, string | undefined>>,
): HostConfig {
  const production = env.NODE_ENV === "production";
  const rawPattern = env.SHOWCASE_BACKEND_HOST_PATTERN?.trim();
  let backendHostPattern: string | undefined;
  let backendConfigStatus: HostConfig["backendConfigStatus"];
  if (!rawPattern) {
    backendConfigStatus = "missing";
  } else {
    try {
      validateBackendHostPattern(rawPattern, production);
      backendHostPattern = rawPattern;
      backendConfigStatus = "valid";
    } catch {
      backendConfigStatus = "invalid";
    }
  }

  return {
    port: parsePort(env.PORT?.trim()),
    production,
    backendHostPattern,
    backendConfigStatus,
    frameAncestors: parseFrameAncestors(env.SHOWCASE_FRAME_ANCESTORS?.trim()),
  };
}

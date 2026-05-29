import type { RecordUserActionInput } from "../hooks/use-record-user-action";
import { defaultMapToAction } from "./map";
import { toAbsoluteUrl } from "./parse";
import { redactUrlQuery, redactValue, resolveRedaction } from "./redact";
import type { ResolvedRedaction } from "./redact";
import type {
  AutoCaptureUserActionsConfig,
  CapturedRequest,
  HttpMethod,
  RawExchange,
} from "./types";

/** Methods captured when the developer does not specify their own set. */
export const DEFAULT_METHODS: readonly HttpMethod[] = [
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

/** Normalized form of {@link AutoCaptureUserActionsConfig} used by the pipeline. */
export interface ResolvedAutoCaptureConfig {
  methods: Set<string>;
  /** `undefined` means "fall back to same-origin / `allowOrigins`". */
  allowUrls?: Array<string | RegExp>;
  denyUrls: Array<string | RegExp>;
  allowOrigins: string[];
  denyOrigins: string[];
  captureResponseBody: boolean;
  redaction: ResolvedRedaction;
  transform?: AutoCaptureUserActionsConfig["transform"];
}

/** Normalize a public config into the resolved shape used internally. */
export function resolveConfig(
  config: AutoCaptureUserActionsConfig,
): ResolvedAutoCaptureConfig {
  return {
    methods: new Set(
      (config.methods ?? DEFAULT_METHODS).map((method) => method.toUpperCase()),
    ),
    allowUrls: config.allowUrls,
    denyUrls: config.denyUrls ?? [],
    allowOrigins: config.allowOrigins ?? [],
    denyOrigins: config.denyOrigins ?? [],
    captureResponseBody: config.captureResponseBody ?? true,
    redaction: resolveRedaction(config.redact),
    transform: config.transform,
  };
}

/**
 * Bare-hostname shape — used by {@link matchesPattern} to switch from
 * substring matching to exact-hostname matching when the pattern looks like
 * a domain. Without this, `"api.foo.com"` would also match
 * `"https://api.foo.com.attacker.test/x"` via plain substring.
 */
const BARE_HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

const matchesPattern = (url: string, pattern: string | RegExp): boolean => {
  if (pattern instanceof RegExp) return pattern.test(url);
  if (BARE_HOSTNAME.test(pattern)) {
    try {
      return new URL(url).hostname === pattern;
    } catch {
      return false;
    }
  }
  return url.includes(pattern);
};

/** Whether the URL's origin appears in `origins` exactly. */
const matchesAnyOrigin = (url: string, origins: string[]): boolean => {
  if (origins.length === 0) return false;
  try {
    const origin = new URL(url).origin;
    return origins.includes(origin);
  } catch {
    return false;
  }
};

const stripToOriginPath = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return url.split("?")[0] ?? url;
  }
};

const isSameOrigin = (url: string, origin: string | null): boolean => {
  if (!origin) return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};

/**
 * Whether `url` is the platform's own `${runtimeUrl}/user-actions` endpoint.
 * This is the loop guard: the recorder's POST flows through the patched fetch,
 * so it must always be excluded regardless of config.
 */
export function isUserActionsEndpoint(
  url: string,
  runtimeUrl: string | undefined,
): boolean {
  if (!runtimeUrl) return false;
  const target = stripToOriginPath(
    toAbsoluteUrl(`${runtimeUrl.replace(/\/$/, "")}/user-actions`),
  );
  return stripToOriginPath(url) === target;
}

/** Context the pipeline needs that is resolved per render by the React hook. */
export interface PipelineContext {
  config: ResolvedAutoCaptureConfig;
  /** `window.location.origin`, or `null` outside the browser. */
  origin: string | null;
  /** The configured runtime URL, used only for self-exclusion. */
  runtimeUrl: string | undefined;
  /** Returns the threadId to record under, or `null` when none is resolvable. */
  resolveThreadId: () => string | null;
  /** Fire-and-forget recorder; the caller owns promise/error handling. */
  record: (input: RecordUserActionInput) => void;
  /** Invoked when a captureable request has no resolvable thread. */
  onMissingThread: () => void;
}

/**
 * Decide whether a request is eligible for capture: correct method, not the
 * platform's own endpoint, not denied, and in scope (allow-list, else
 * same-origin).
 */
export function shouldCapture(
  method: string,
  url: string,
  ctx: Pick<PipelineContext, "config" | "origin" | "runtimeUrl">,
): boolean {
  if (!ctx.config.methods.has(method.toUpperCase())) return false;
  if (isUserActionsEndpoint(url, ctx.runtimeUrl)) return false;

  if (ctx.config.denyUrls.some((pattern) => matchesPattern(url, pattern))) {
    return false;
  }
  if (matchesAnyOrigin(url, ctx.config.denyOrigins)) return false;

  // Allow logic — additive across all positive rules:
  //  * `allowOrigins` always layers on top (no footgun: it never dethrones
  //    same-origin or `allowUrls`).
  //  * If the caller supplied `allowUrls`, that becomes the URL-level
  //    whitelist (replacing the same-origin default for URL-pattern
  //    matching); origin-level allow still applies.
  //  * Otherwise the same-origin default applies.
  if (matchesAnyOrigin(url, ctx.config.allowOrigins)) return true;
  if (ctx.config.allowUrls) {
    return ctx.config.allowUrls.some((pattern) => matchesPattern(url, pattern));
  }
  return isSameOrigin(url, ctx.origin);
}

/** Apply redaction to a raw exchange, producing the public {@link CapturedRequest}. */
function buildCaptured(
  raw: RawExchange,
  config: ResolvedAutoCaptureConfig,
): CapturedRequest {
  return {
    method: raw.method.toUpperCase() as HttpMethod,
    url: redactUrlQuery(raw.url, config.redaction),
    requestBody: redactValue(raw.requestBody, config.redaction),
    status: raw.status,
    responseBody: config.captureResponseBody
      ? redactValue(raw.responseBody, config.redaction)
      : undefined,
    durationMs: raw.durationMs,
  };
}

/**
 * Process one intercepted HTTP exchange end-to-end: filter → resolve thread →
 * redact → map (or `transform`) → record. Never throws — capture must never
 * affect the host application's request.
 */
export function processExchange(raw: RawExchange, ctx: PipelineContext): void {
  try {
    if (!shouldCapture(raw.method, raw.url, ctx)) return;

    const threadId = ctx.resolveThreadId();
    if (!threadId) {
      ctx.onMissingThread();
      return;
    }

    const captured = buildCaptured(raw, ctx.config);
    const action = ctx.config.transform
      ? ctx.config.transform(captured)
      : defaultMapToAction(captured, ctx.config.captureResponseBody);

    if (action == null) return;

    ctx.record({ ...action, threadId });
  } catch {
    // Capture is best-effort and must never surface into the host app.
  }
}

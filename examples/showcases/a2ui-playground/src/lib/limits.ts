/**
 * The limits that make the hosted playground safe on a public URL, where every
 * agent run spends the server's model keys. Every number is here, and the
 * README's Hosting section lists them. Server only.
 *
 * The rate limiter keeps its counts in memory. That is right for the one
 * Railway instance the playground runs on; with more instances, each one counts
 * on its own and the real limits multiply by the number of instances.
 */
import type { CopilotRuntimeHooks } from "@copilotkit/runtime/v2";

const MINUTE = 60_000;

/** A token bucket: up to `burst` requests at once, refilled at `rate` per `windowMs`. */
export type RateLimit = { rate: number; windowMs: number; burst: number };

const envNumber = (name: string) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export const RATE_LIMITS = {
  /** Agent runs per visitor: a burst of 6, then 12 per 10 minutes. `AGENT_RUNS_PER_10_MIN` changes the 12. */
  agent: {
    rate: envNumber("AGENT_RUNS_PER_10_MIN") ?? 12,
    windowMs: 10 * MINUTE,
    burst: 6,
  },
  /** Agent runs across every visitor, so no crowd can drain a key: 300 an hour, 60 at once. */
  agentOverall: { rate: 300, windowMs: 60 * MINUTE, burst: 60 },
  /** The cheap routes: no model, just CPU. */
  express: { rate: 60, windowMs: MINUTE, burst: 30 },
  skills: { rate: 60, windowMs: MINUTE, burst: 30 },
  models: { rate: 30, windowMs: MINUTE, burst: 10 },
} satisfies Record<string, RateLimit>;

/** Request bodies, in bytes. A run carries the catalog (about 135 KB) and the whole chat, so its cap is the largest. */
export const MAX_BODY = {
  agent: 1024 * 1024,
  express: 512 * 1024,
  skills: 64 * 1024,
};

/** What the agent reads of a chat: the newest messages, each user message (and tool call's arguments) cut to this many characters, and at most MAX_HISTORY_CHARS of chat in the router's prompt. */
export const MAX_MESSAGES = 40;
export const MAX_PROMPT_CHARS = 4000;
export const MAX_HISTORY_CHARS = 60_000;

/** Lookups one prompt can start: `get_*` data calls per run, geocoded map pins and expanded macros per surface. */
export const MAX_DATA_CALLS = 4;
export const MAX_GEOCODED_MARKERS = 12;
export const MAX_MACROS = 6;

/** Components `/api/express` decompiles in one request. Real surfaces have under 100. */
export const MAX_EXPRESS_COMPONENTS = 1000;

/** The JSON composer's prompt lists the catalog the browser sent; the real one comes to about 26,000 characters. */
export const MAX_CATALOG_PROMPT_CHARS = 80_000;

/** Output tokens per model call. Real surfaces use under 3,000; the rest is headroom (and thinking, where a model can't turn it off). */
export const ROUTER_MAX_TOKENS = 4096;
export const COMPOSER_MAX_TOKENS = 16384;

/* ───────────────────────── rate limiting ───────────────────────── */

/** The visitor's address: the first X-Forwarded-For entry (Railway's proxy sets it), else X-Real-IP. */
// Tested on the live Railway deploy: a spoofed X-Forwarded-For did not get past the limit.
export function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

class Buckets {
  private buckets = new Map<string, { tokens: number; at: number }>();
  private sweptAt = 0;
  private refillMs: number;

  constructor(private limit: RateLimit) {
    this.refillMs = limit.windowMs / limit.rate;
  }

  /** Requests `key` could make right now, refilled since its last one. */
  private level(key: string, now: number) {
    const b = this.buckets.get(key);
    return b
      ? Math.min(this.limit.burst, b.tokens + (now - b.at) / this.refillMs)
      : this.limit.burst;
  }

  /** Seconds until `key` may make a request; 0 when it may now. */
  wait(key: string, now: number) {
    const level = this.level(key, now);
    return level >= 1 ? 0 : Math.ceil(((1 - level) * this.refillMs) / 1000);
  }

  take(key: string, now: number) {
    this.buckets.set(key, { tokens: this.level(key, now) - 1, at: now });
    // Now and then, forget the visitors whose bucket has refilled, so the map only holds recent ones.
    if (now - this.sweptAt < this.limit.windowMs) return;
    this.sweptAt = now;
    for (const k of this.buckets.keys())
      if (this.level(k, now) >= this.limit.burst) this.buckets.delete(k);
  }
}

const tooMany = (seconds: number, error: string) =>
  Response.json(
    { error },
    { status: 429, headers: { "Retry-After": String(seconds) } },
  );

/**
 * A limiter for one route: per visitor IP and, optionally, across everyone.
 * Returns the 429 to send, or undefined when the request may go ahead (and is counted).
 */
export function rateLimiter(perIp: RateLimit, overall?: RateLimit) {
  const ips = new Buckets(perIp);
  const all = overall ? new Buckets(overall) : undefined;
  return (request: Request): Response | undefined => {
    const now = Date.now();
    const ip = clientIp(request);
    const mine = ips.wait(ip, now);
    if (mine)
      return tooMany(
        mine,
        "You're sending a lot of requests. Try again in a minute.",
      );
    const everyone = all?.wait("all", now) ?? 0;
    if (everyone)
      return tooMany(
        everyone,
        "The playground is busy right now. Try again in a minute.",
      );
    ips.take(ip, now);
    all?.take("all", now);
    return undefined;
  };
}

/* ───────────────────────── request size ───────────────────────── */

export const tooLarge = (error = "This request is too large.") =>
  Response.json({ error }, { status: 413 });

/** The request body as text, or null when it is over `max` bytes. Reading stops at the limit. */
export async function readBody(
  request: Request,
  max: number,
): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      void reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/* ───────────────────────── agent routes ───────────────────────── */

/** Agent runs, counted together for every route that runs an agent (`/api/copilotkit` and the opt-in demos). */
export const limitAgentRuns = rateLimiter(
  RATE_LIMITS.agent,
  RATE_LIMITS.agentOverall,
);

const RUNS = new Set(["agent/run", "agent/suggest"]);

/** Whether a body has what the runtime needs to start a run (AG-UI `RunAgentInput`): one it would refuse with a 400 spends nothing. */
function isRunInput(body: string) {
  try {
    const j = JSON.parse(body) as {
      threadId?: unknown;
      runId?: unknown;
      messages?: unknown;
    } | null;
    return (
      typeof j?.threadId === "string" &&
      typeof j.runId === "string" &&
      Array.isArray(j.messages)
    );
  } catch {
    return false;
  }
}

/**
 * Hooks for a CopilotKit runtime route that runs an agent. The body cap runs
 * before routing, since a path that matches no route reads the body too. Only
 * the routes that run the agent spend model tokens, so only they count toward
 * the rate limit, and only with a body that can start a run. `info` and
 * `agent/connect` (sent when the page loads) and `agent/stop` don't count.
 * A Response thrown in a hook is sent as it is.
 */
export function agentRouteHooks(tooLong?: string): CopilotRuntimeHooks {
  return {
    onRequest: async ({ request }) => {
      if (!request.body) return;
      const body = await readBody(request, MAX_BODY.agent);
      if (body === null) throw tooLarge(tooLong);
      // From its parts: a route without `dynamic = "force-dynamic"` gets a proxied request, which `new Request(request)` rejects.
      return new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body,
        signal: request.signal,
      });
    },
    onBeforeHandler: async ({ request, route }) => {
      if (!RUNS.has(route.method) || !isRunInput(await request.clone().text()))
        return;
      const limited = limitAgentRuns(request);
      if (limited) throw limited;
    },
  };
}

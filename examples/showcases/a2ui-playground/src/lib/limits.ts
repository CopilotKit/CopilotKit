/**
 * The limits that make the hosted playground safe on a public URL, where every
 * agent run spends the server's model keys. Every number is here, and the
 * README's "Hosting it safely" section lists them. Server only.
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
  /** Every request to an agent route per visitor (page startup, `connect`, `stop`, runs). Only runs spend tokens, but each request reads up to MAX_BODY.agent. */
  agentRoute: { rate: 120, windowMs: MINUTE, burst: 60 },
  /** The cheap routes: no model, just CPU. */
  express: { rate: 60, windowMs: MINUTE, burst: 30 },
  skills: { rate: 60, windowMs: MINUTE, burst: 30 },
  models: { rate: 30, windowMs: MINUTE, burst: 10 },
} satisfies Record<string, RateLimit>;

/**
 * Agent runs across every visitor per UTC day: the spend ceiling. A run has a cost ceiling of its own (at most 4 model
 * calls, each under the output caps below), so this caps a day's spend. `AGENT_RUNS_PER_DAY` changes it.
 */
export const AGENT_RUNS_PER_DAY = envNumber("AGENT_RUNS_PER_DAY") ?? 3000;

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

/** Nominatim calls waiting their turn (1 a second, one queue for every visitor). Past this a lookup goes to its fallback (Photon, Open-Meteo) instead of waiting minutes. */
export const MAX_QUEUED_LOOKUPS = 20;

/** Components `/api/express` decompiles in one request. Real surfaces have under 100. */
export const MAX_EXPRESS_COMPONENTS = 1000;

/** The JSON composer's prompt lists the catalog the browser sent; the real one comes to about 26,000 characters. */
export const MAX_CATALOG_PROMPT_CHARS = 80_000;

/** Output tokens per model call. Real surfaces use under 3,000; the rest is headroom (and thinking, where a model can't turn it off). */
export const ROUTER_MAX_TOKENS = 4096;
export const COMPOSER_MAX_TOKENS = 16384;

/* ───────────────────────── rate limiting ───────────────────────── */

/**
 * The visitor's address: the first X-Forwarded-For entry (Railway's proxy sets it), else X-Real-IP.
 * An IPv6 visitor counts by its /64, the block one home or server gets, so cycling addresses inside it
 * doesn't earn a fresh limit; an IPv4 address loses any port.
 */
// Tested on the live Railway deploy: a spoofed X-Forwarded-For did not get past the limit.
export function clientIp(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  if (!ip.includes(":")) return ip;
  // IPv4 with a port, or mapped into IPv6 (`::ffff:203.0.113.9`).
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/.exec(ip);
  if (v4) return v4[1];
  const [head, tail] = ip
    .replace(/^\[|\](?::\d+)?$/g, "")
    .split("%")[0]
    .toLowerCase()
    .split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const gap = Math.max(0, 8 - left.length - right.length);
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array<string>(gap).fill("0"), ...right];
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
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
const limitRuns = rateLimiter(RATE_LIMITS.agent, RATE_LIMITS.agentOverall);
const limitRouteRequests = rateLimiter(RATE_LIMITS.agentRoute);

/** Runs started on one UTC day, for AGENT_RUNS_PER_DAY. */
const runsToday = { date: "", runs: 0 };
const utcDate = (now: number) => new Date(now).toISOString().slice(0, 10);

/**
 * Why live runs are off on this server (in visitor words, with seconds until
 * they may be on again), or undefined while they are on. `AGENT_RUNS_PAUSED=1`
 * is the kill switch; AGENT_RUNS_PER_DAY turns them off until midnight UTC.
 * The recorded replay never runs the agent, so it keeps playing, and
 * `GET /api/models` shows the reason in the model picker.
 */
export function liveRunsOff(now = Date.now()) {
  // "true" too: a switch flipped during an incident must not fail on spelling.
  if (["1", "true"].includes(process.env.AGENT_RUNS_PAUSED?.trim() ?? ""))
    return {
      reason: "Live runs are paused on this server for now.",
      retryAfter: 600,
    };
  const date = utcDate(now);
  if (runsToday.date === date && runsToday.runs >= AGENT_RUNS_PER_DAY)
    return {
      reason: "The playground has used today's live runs. Try again tomorrow.",
      retryAfter: Math.ceil((Date.parse(date) + 24 * 60 * MINUTE - now) / 1000),
    };
  return undefined;
}

/** A page on another site can make its visitors' browsers POST text/plain here unasked, but JSON only after a CORS preflight, which this site never grants. */
const isJson = (request: Request) =>
  request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ===
  "application/json";

/**
 * Whether one agent run may start: sent as JSON (so no other site can spend
 * the keys through its visitors' browsers), while live runs are on, and within
 * the rate limits. Returns the response to send, or undefined when the run may
 * go ahead (and is counted).
 */
export function admitAgentRun(request: Request): Response | undefined {
  if (!isJson(request))
    return Response.json(
      { error: "Send the run as application/json." },
      { status: 415 },
    );
  const now = Date.now();
  // A 429, not a 503: the chat shows the error text of a 429 (or 413), and a generic failure for anything else.
  const off = liveRunsOff(now);
  if (off) return tooMany(off.retryAfter, off.reason);
  const limited = limitRuns(request);
  if (limited) return limited;
  const date = utcDate(now);
  if (runsToday.date !== date) Object.assign(runsToday, { date, runs: 0 });
  runsToday.runs++;
  return undefined;
}

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
 * the run limits (`admitAgentRun`), and only with a body that can start a run.
 * `info` and `agent/connect` (sent when the page loads) and `agent/stop` don't
 * count as runs; every request, those included, counts toward
 * RATE_LIMITS.agentRoute. A Response thrown in a hook is sent as it is.
 */
export function agentRouteHooks(tooLong?: string): CopilotRuntimeHooks {
  return {
    onRequest: async ({ request }) => {
      const limited = limitRouteRequests(request);
      if (limited) throw limited;
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
      const refused = admitAgentRun(request);
      if (refused) throw refused;
    },
  };
}

/**
 * The limits that make this demo safe on a public URL, where every agent run
 * spends the server's model key. Ported from the A2UI Playground
 * (examples/showcases/a2ui-playground/src/lib/limits.ts). Server only.
 *
 * The counts live in memory. That is right for the one Railway instance the
 * demo runs on; with more instances, each one counts on its own and the real
 * limits multiply by the number of instances.
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
  /** Agent runs across every visitor, so no crowd can drain the key: 300 an hour, 60 at once. `AGENT_RUNS_PER_HOUR` changes the 300. */
  agentOverall: {
    rate: envNumber("AGENT_RUNS_PER_HOUR") ?? 300,
    windowMs: 60 * MINUTE,
    burst: 60,
  },
  /** Every request to the runtime route per visitor (page startup, `connect`, `stop`, runs). */
  agentRoute: { rate: 120, windowMs: MINUTE, burst: 60 },
} satisfies Record<string, RateLimit>;

/** Agent runs across every visitor per UTC day: the spend ceiling. `AGENT_RUNS_PER_DAY` changes it. */
export const AGENT_RUNS_PER_DAY = envNumber("AGENT_RUNS_PER_DAY") ?? 1000;

/** Request body cap, in bytes. A run carries the component schema and the whole chat. */
export const MAX_BODY = 1024 * 1024;

/* ───────────────────────── rate limiting ───────────────────────── */

/**
 * The visitor's address: the first X-Forwarded-For entry (Railway's proxy sets
 * it), else X-Real-IP. An IPv6 visitor counts by its /64, so cycling addresses
 * inside it doesn't earn a fresh limit; an IPv4 address loses any port.
 */
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
 * A limiter per visitor IP and, optionally, across everyone. Returns the 429
 * to send, or undefined when the request may go ahead (and is counted).
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
        "The demo is busy right now. Try again in a minute.",
      );
    ips.take(ip, now);
    all?.take("all", now);
    return undefined;
  };
}

/* ───────────────────────── request size ───────────────────────── */

const tooLarge = (error: string) => Response.json({ error }, { status: 413 });

/** The request body as text, or null when it is over `max` bytes. Reading stops at the limit. */
async function readBody(request: Request, max: number): Promise<string | null> {
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

/* ───────────────────────── agent runs ───────────────────────── */

const limitRuns = rateLimiter(RATE_LIMITS.agent, RATE_LIMITS.agentOverall);
const limitRouteRequests = rateLimiter(RATE_LIMITS.agentRoute);

/** Runs started on one UTC day, for AGENT_RUNS_PER_DAY. */
const runsToday = { date: "", runs: 0 };
const utcDate = (now: number) => new Date(now).toISOString().slice(0, 10);

/**
 * Why live runs are off (in visitor words, with seconds until they may be on
 * again), or undefined while they are on. `AGENT_RUNS_PAUSED=1` is the kill
 * switch; AGENT_RUNS_PER_DAY turns them off until midnight UTC.
 */
function liveRunsOff(now: number) {
  if (["1", "true"].includes(process.env.AGENT_RUNS_PAUSED?.trim() ?? ""))
    return {
      reason: "Live runs are paused on this demo for now.",
      retryAfter: 600,
    };
  const date = utcDate(now);
  if (runsToday.date === date && runsToday.runs >= AGENT_RUNS_PER_DAY)
    return {
      reason: "The demo has used today's live runs. Try again tomorrow.",
      retryAfter: Math.ceil((Date.parse(date) + 24 * 60 * MINUTE - now) / 1000),
    };
  return undefined;
}

/** Another site can make its visitors' browsers POST text/plain here unasked, but JSON only after a CORS preflight, which this site never grants. */
const isJson = (request: Request) =>
  request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ===
  "application/json";

/**
 * Whether one agent run may start: sent as JSON, while live runs are on, and
 * within the rate limits. Returns the response to send, or undefined when the
 * run may go ahead (and is counted).
 */
function admitAgentRun(request: Request): Response | undefined {
  if (!isJson(request))
    return Response.json(
      { error: "Send the run as application/json." },
      { status: 415 },
    );
  const now = Date.now();
  // A 429, not a 503: the chat shows the error text of a 429.
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
 * Hooks for the CopilotKit runtime route. The body cap runs before routing.
 * Only the routes that run the agent spend model tokens, so only they count
 * toward the run limits, and only with a body that can start a run. Every
 * request counts toward RATE_LIMITS.agentRoute. A Response thrown in a hook
 * is sent as it is.
 */
export function agentRouteHooks(): CopilotRuntimeHooks {
  return {
    onRequest: async ({ request }) => {
      const limited = limitRouteRequests(request);
      if (limited) throw limited;
      if (!request.body) return;
      const body = await readBody(request, MAX_BODY);
      if (body === null)
        throw tooLarge(
          "This chat is too long to send. Reload the page to start over.",
        );
      // Rebuilt from its parts: `new Request(request)` rejects a proxied request.
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

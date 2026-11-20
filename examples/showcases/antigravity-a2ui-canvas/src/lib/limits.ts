/**
 * The limits that make this demo safe on a public URL, where every agent run
 * spends the server's Gemini key. The same limiter as the A2UI Playground
 * showcase, with counts for this page: each message makes two or three runs
 * (the turn, then one or two that hand the render result back). Server only.
 *
 * The counts live in memory. That is right for the one Railway instance the
 * demo runs on; with more instances, each one counts on its own and the real
 * limits multiply by the number of instances.
 */
import { RunAgentInputSchema } from "@ag-ui/core/schemas";
import type { CopilotRuntimeHooks, RouteInfo } from "@copilotkit/runtime/v2";
import { AGENT_ID } from "@/agent";

const MINUTE = 60_000;

/** A token bucket: up to `burst` requests at once, refilled at `rate` per `windowMs`. */
export type RateLimit = { rate: number; windowMs: number; burst: number };

const envNumber = (name: string) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export const RATE_LIMITS = {
  /** Agent runs per visitor: a burst of 15 (the whole demo script), then 30 per 10 minutes. `AGENT_RUNS_PER_10_MIN` changes the 30. */
  agent: {
    rate: envNumber("AGENT_RUNS_PER_10_MIN") ?? 30,
    windowMs: 10 * MINUTE,
    burst: 15,
  },
  /** Agent runs across every visitor, so no crowd can drain the key: 600 an hour, 100 at once. `AGENT_RUNS_PER_HOUR` changes the 600. */
  agentOverall: {
    rate: envNumber("AGENT_RUNS_PER_HOUR") ?? 600,
    windowMs: 60 * MINUTE,
    burst: 100,
  },
  /** Every request to the runtime route per visitor (page startup, `connect`, `stop`, runs). */
  agentRoute: { rate: 120, windowMs: MINUTE, burst: 60 },
} satisfies Record<string, RateLimit>;

/** Agent runs across every visitor per UTC day: the spend ceiling. `AGENT_RUNS_PER_DAY` changes it. */
export const AGENT_RUNS_PER_DAY = envNumber("AGENT_RUNS_PER_DAY") ?? 2000;

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

/** A route that runs this page's agent, which is what spends model tokens. A run for another agent id gets a 404. */
const runsTheAgent = (route: RouteInfo) =>
  (route.method === "agent/run" || route.method === "agent/suggest") &&
  route.agentId === AGENT_ID;

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const MEDIA = new Set(["image", "audio", "video", "document"]);

/** `value` without `field` when it is null, which AG-UI 0.x sent where 1.0 leaves the field out. */
function withoutNull(value: unknown, field: string): unknown {
  if (!isObject(value) || value[field] !== null) return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== field));
}

const mediaTypeFor = (mimeType: string) =>
  mimeType.startsWith("image/")
    ? "image"
    : mimeType.startsWith("audio/")
      ? "audio"
      : mimeType.startsWith("video/")
        ? "video"
        : "document";

type MediaPart = {
  type: string;
  source: { type: string; value: string; mimeType: string };
};

const sameSource = (part: unknown, converted: MediaPart) =>
  isObject(part) &&
  part.type === converted.type &&
  isObject(part.source) &&
  part.source.type === converted.source.type &&
  part.source.value === converted.source.value &&
  part.source.mimeType === converted.source.mimeType;

/**
 * 0.x `{ type: "binary" }` content parts, rewritten the way the runtime
 * rewrites them (`upgradeLegacyBinaryParts`): data or url becomes the media
 * part its mime type names, a part with neither is dropped, and so is one that
 * only repeats a modern part already in the message.
 */
function upgradeBinaryParts(content: unknown[]): unknown[] {
  return content.flatMap((part) => {
    if (
      !isObject(part) ||
      part.type !== "binary" ||
      typeof part.mimeType !== "string"
    )
      return [part];
    const kind =
      typeof part.data === "string"
        ? "data"
        : typeof part.url === "string"
          ? "url"
          : null;
    if (kind === null) return [];
    const converted: MediaPart & { metadata?: { filename: string } } = {
      type: mediaTypeFor(part.mimeType),
      source: {
        type: kind,
        value: String(kind === "data" ? part.data : part.url),
        mimeType: part.mimeType,
      },
      ...(typeof part.filename === "string" && {
        metadata: { filename: part.filename },
      }),
    };
    return content.some((other) => sameSource(other, converted))
      ? []
      : [converted];
  });
}

/**
 * Whether the runtime would start a run from this body. It checks AG-UI's own
 * `RunAgentInput` schema, the one the runtime parses with, against the whole
 * body after the same clean-up the runtime does first
 * (`normalizeLegacyRunAgentInput` in its agent-utils): 0.x binary content parts
 * become media parts, and optional fields sent as null are dropped.
 */
export function isRunInput(body: string): boolean {
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return false;
  }
  if (!isObject(input)) return false;
  const { tools, resume, messages } = input;
  const cleaned = {
    ...(withoutNull(input, "forwardedProps") as JsonObject),
    ...(Array.isArray(tools) && {
      tools: tools.map((tool) => withoutNull(tool, "parameters")),
    }),
    ...(Array.isArray(resume) && {
      resume: resume.map((entry) => withoutNull(entry, "payload")),
    }),
    ...(Array.isArray(messages) && {
      messages: messages.map((message) =>
        isObject(message) && Array.isArray(message.content)
          ? {
              ...message,
              content: upgradeBinaryParts(message.content).map((part) =>
                isObject(part) && MEDIA.has(String(part.type))
                  ? withoutNull(part, "metadata")
                  : part,
              ),
            }
          : message,
      ),
    }),
  };
  return RunAgentInputSchema.safeParse(cleaned).success;
}

/**
 * Hooks for the CopilotKit runtime route. The body cap runs before routing.
 * Only the routes that run the agent spend model tokens, so only they count
 * toward the run limits, and only with a body the runtime will accept: one it
 * refuses with a 400 spends nothing. Every request, refused or not, counts
 * toward RATE_LIMITS.agentRoute. A Response thrown in a hook is sent as it is.
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
      if (!runsTheAgent(route) || !isRunInput(await request.clone().text()))
        return;
      const refused = admitAgentRun(request);
      if (refused) throw refused;
    },
  };
}

import { describe, it, expect } from "vitest";
import {
  createStarterSmokeDriver,
  starterSmokeDriver,
} from "./starter-smoke.js";
import type {
  StarterSmokeAggregateSignal,
  StarterSmokeLevelSignal,
} from "./starter-smoke.js";
import { STARTER_LEVELS } from "../helpers/starter-mapping.js";
import { logger } from "../../logger.js";
import type {
  ProbeContext,
  ProbeResult,
  ProbeResultWriter,
} from "../../types/index.js";

// Driver-level tests for the starter_smoke ProbeDriver. The deployed starter
// services mount `createCopilotEndpoint` in its default `mode:"multi-route"`
// (PATH-BASED v2 protocol) at `basePath:"/api/copilotkit"`. Every test
// injects a fake `fetchImpl` that speaks that path-based protocol — no real
// network.
// Coverage:
//   - schema accepts the discovery shape, rejects malformed input
//   - the FOUR checks (health/agent/chat/interaction) map to the right
//     `starter:<col>/<level>` side-emit keys
//   - the starter→column slug remap is applied before emit
//   - pass → green, fail → red (smoke-failed), transport-fail → classified
//   - the aggregate primary is emitted under `starter:<col>`
//
// Protocol (empirically proven by a local build+curl gate; identical at
// 1.59.3 and 1.59.5; verified against
// `packages/runtime/src/v2/runtime/core/fetch-router.ts` `matchRoute` and
// the real starter route
// `examples/integrations/<slug>/src/app/api/copilotkit/[[...slug]]/route.ts`):
//   - health rung: GET `/api/copilotkit/info` → 200 (lightweight runtime
//     liveness; the deployed starter has NO `/api/health` route).
//   - agent rung: GET `/api/copilotkit/info` → 200 JSON carrying a `version`.
//   - chat rung: POST `/api/copilotkit/agent/default/run` with
//     `Accept: text/event-stream` → AG-UI SSE stream
//     (`RUN_STARTED → STEP_STARTED → TEXT_MESSAGE_START →
//     TEXT_MESSAGE_CONTENT(delta) → TEXT_MESSAGE_END → MESSAGES_SNAPSHOT →
//     STATE_SNAPSHOT → STEP_FINISHED → RUN_FINISHED`); pass requires ≥1
//     TEXT_MESSAGE_CONTENT/TEXT_MESSAGE_CHUNK with a non-empty delta AND a
//     terminal RUN_FINISHED with NO RUN_ERROR in the stream.

function mkWriter(): {
  writer: ProbeResultWriter;
  writes: ProbeResult<unknown>[];
} {
  const writes: ProbeResult<unknown>[] = [];
  const writer: ProbeResultWriter = {
    async write(result) {
      writes.push(result);
      return undefined;
    },
  };
  return { writer, writes };
}

/**
 * A protocol-accurate AG-UI SSE stream for a successful `agent/run`, seeded
 * from a REAL captured crewai-crews happy-path stream (the "Hello" turn
 * against the deployed starter). The concatenated `TEXT_MESSAGE_CONTENT`
 * deltas reconstruct the assistant reply
 *   "Hello! I'm the crewai-crews AI assistant. How can I help you?"
 * and the stream terminates in RUN_FINISHED. On-wire format is
 * `data: <json>\n\n` per event (see `sse-interceptor.ts`).
 */
const HAPPY_DELTAS = [
  "Hello! ",
  "I'm the crewai-crews AI assistant. ",
  "How can I help you?",
];
const SSE_HAPPY = [
  { type: "RUN_STARTED", threadId: "t1", runId: "run-1" },
  { type: "STEP_STARTED", stepName: "step-1" },
  {
    type: "TEXT_MESSAGE_START",
    messageId: "chatcmpl-abc123",
    role: "assistant",
  },
  ...HAPPY_DELTAS.map((delta) => ({
    type: "TEXT_MESSAGE_CONTENT",
    messageId: "chatcmpl-abc123",
    delta,
  })),
  { type: "TEXT_MESSAGE_END", messageId: "chatcmpl-abc123" },
  { type: "MESSAGES_SNAPSHOT", messages: [] },
  { type: "STATE_SNAPSHOT", state: {} },
  { type: "STEP_FINISHED", stepName: "step-1" },
  { type: "RUN_FINISHED", threadId: "t1", runId: "run-1" },
]
  .map((e) => `data: ${JSON.stringify(e)}\n\n`)
  .join("");

/** A stream that opens a run then errors — no text content event. */
const SSE_RUN_ERROR = [
  { type: "RUN_STARTED", threadId: "t1", runId: "run-1" },
  { type: "RUN_ERROR", message: "boom" },
]
  .map((e) => `data: ${JSON.stringify(e)}\n\n`)
  .join("");

/** A 200 stream that produces lifecycle events but NO text content. */
const SSE_NO_TEXT = [
  { type: "RUN_STARTED", threadId: "t1", runId: "run-1" },
  { type: "RUN_FINISHED", threadId: "t1", runId: "run-1" },
]
  .map((e) => `data: ${JSON.stringify(e)}\n\n`)
  .join("");

/**
 * Fake fetch that speaks the PATH-BASED (multi-route) runtime protocol.
 * Levels are distinguished purely by URL path:
 *   - `GET /api/copilotkit/info`           → health AND agent rungs (both
 *     hit the same info route with the same GET method, so the request alone
 *     can't tell them apart; we disambiguate by call order via a per-instance
 *     `infoCalls` counter — see below).
 *   - `POST /api/copilotkit/agent/<id>/run` → chat rung.
 *   - `GET /`                               → interaction rung.
 *
 * Because health and agent both target `/api/copilotkit/info` with GET, we
 * cannot tell them apart by request alone. The driver issues them in
 * STARTER_LEVELS order (health before agent), so the fake returns the same
 * info payload for both and records the URL under whichever level is asked
 * first. We track an info-call counter so `seenUrls` maps the 1st info GET
 * to `health` and the 2nd to `agent`.
 *
 * - `agentBody` overrides the `info` JSON response body (default: a valid
 *   `{version}` info payload). Applies to BOTH health and agent rungs since
 *   they share the route; tests that need them to differ set the relevant
 *   status override.
 * - `chatSse`   overrides the chat SSE stream text (default: SSE_HAPPY).
 */
/**
 * Wrap a Response so reading its body aborts mid-stream: `.text()` rejects
 * with an AbortError, mimicking a slow cold-start SSE body that streams past
 * the per-check timeout and gets `controller.abort()`-ed mid-`res.text()`.
 * Used to prove F2 — a body-read abort is a transport hiccup, not a
 * smoke-failed regression.
 */
function makeBodyAbortingResponse(res: Response): Response {
  const abortErr = new Error("The operation was aborted");
  abortErr.name = "AbortError";
  // Override `.text()` directly on the instance (NOT via Proxy — a Proxy
  // breaks Response's private-field getters like `.ok`/`.status`). The real
  // Response's status/ok getters stay intact; only the body read rejects.
  Object.defineProperty(res, "text", {
    configurable: true,
    writable: true,
    value: async () => {
      throw abortErr;
    },
  });
  return res;
}

function fakeFetch(opts: {
  healthStatus?: number;
  healthBody?: string;
  agentStatus?: number;
  agentBody?: string;
  chatStatus?: number;
  chatSse?: string;
  interactionStatus?: number;
  // When set for a level, that fetch rejects (transport failure).
  throwOn?: Partial<Record<"health" | "agent" | "chat" | "interaction", Error>>;
  // When set for a level, the fetch RESOLVES (200) but reading its body aborts
  // mid-stream (simulating a slow cold-start body that streams past the
  // timeout). `"self"` marks an internal-timeout abort. The Response's
  // `.text()` rejects with an AbortError.
  bodyAbortOn?: Partial<
    Record<"health" | "agent" | "chat" | "interaction", "self">
  >;
  // Captures the URL each level was actually fetched at (assertion hook).
  seenUrls?: Partial<
    Record<"health" | "agent" | "chat" | "interaction", string>
  >;
  // Captures the request headers each level was fetched with (assertion hook).
  // Headers are normalised to a lowercase-keyed plain object so a test can
  // assert the chat rung carries `x-aimock-context` regardless of the casing
  // the driver sent.
  seenHeaders?: Partial<
    Record<"health" | "agent" | "chat" | "interaction", Record<string, string>>
  >;
  // Invoked at the TOP of each fetch (before any response is built), passed
  // the resolved level and the running fetch count. Lets a test fire a
  // mid-flight external abort exactly when the FIRST fetch lands so the
  // SUBSEQUENT levels exercise the loop's pre-iteration abort short-circuit.
  onFetch?: (
    level: "health" | "agent" | "chat" | "interaction",
    callCount: number,
  ) => void;
}): typeof fetch {
  let infoCalls = 0;
  let callCount = 0;
  return (async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    let level: "health" | "agent" | "chat" | "interaction";
    if (
      /\/api\/copilotkit\/agent\/[^/]+\/run$/.test(href) &&
      method === "POST"
    ) {
      level = "chat";
    } else if (href.endsWith("/api/copilotkit/info")) {
      // health and agent both GET the same info route, in STARTER_LEVELS
      // order: 1st info GET = health, 2nd = agent.
      level = infoCalls === 0 ? "health" : "agent";
      infoCalls++;
    } else {
      level = "interaction";
    }

    if (opts.seenUrls) opts.seenUrls[level] = href;
    if (opts.seenHeaders) {
      const normalised: Record<string, string> = {};
      const rawHeaders = init?.headers;
      if (rawHeaders) {
        // The driver passes a plain object literal for the chat rung; normalise
        // its keys to lowercase so the assertion is casing-agnostic.
        const entries =
          rawHeaders instanceof Headers
            ? [...rawHeaders.entries()]
            : Array.isArray(rawHeaders)
              ? rawHeaders
              : Object.entries(rawHeaders);
        for (const [k, v] of entries) {
          normalised[k.toLowerCase()] = String(v);
        }
      }
      opts.seenHeaders[level] = normalised;
    }

    callCount += 1;
    opts.onFetch?.(level, callCount);

    const toThrow = opts.throwOn?.[level];
    if (toThrow) throw toThrow;

    if (level === "health") {
      const status = opts.healthStatus ?? 200;
      const res = new Response(
        opts.healthBody ?? opts.agentBody ?? '{"version":"1.59.5"}',
        {
          status,
          statusText: `HTTP ${status}`,
          headers: { "Content-Type": "application/json" },
        },
      );
      if (opts.bodyAbortOn?.health) return makeBodyAbortingResponse(res);
      return res;
    }
    if (level === "agent") {
      const status = opts.agentStatus ?? 200;
      const res = new Response(opts.agentBody ?? '{"version":"1.59.5"}', {
        status,
        statusText: `HTTP ${status}`,
        headers: { "Content-Type": "application/json" },
      });
      if (opts.bodyAbortOn?.agent) return makeBodyAbortingResponse(res);
      return res;
    }
    if (level === "chat") {
      const status = opts.chatStatus ?? 200;
      const res = new Response(opts.chatSse ?? SSE_HAPPY, {
        status,
        statusText: `HTTP ${status}`,
        headers: { "Content-Type": "text/event-stream" },
      });
      if (opts.bodyAbortOn?.chat) return makeBodyAbortingResponse(res);
      return res;
    }
    const status = opts.interactionStatus ?? 200;
    const res = new Response("<html><body>app shell</body></html>", {
      status,
      statusText: `HTTP ${status}`,
    });
    if (opts.bodyAbortOn?.interaction) return makeBodyAbortingResponse(res);
    return res;
  }) as unknown as typeof fetch;
}

function mkCtx(
  fetchImpl: typeof fetch,
  writer?: ProbeResultWriter,
): ProbeContext {
  return {
    now: () => new Date("2026-06-03T00:00:00Z"),
    logger,
    env: {},
    writer,
    fetchImpl,
  };
}

function sideRows(
  writes: ProbeResult<unknown>[],
): ProbeResult<StarterSmokeLevelSignal>[] {
  return writes as ProbeResult<StarterSmokeLevelSignal>[];
}

describe("starterSmokeDriver", () => {
  it("exposes kind === 'starter_smoke'", () => {
    expect(starterSmokeDriver.kind).toBe("starter_smoke");
  });

  it("inputSchema accepts the discovery shape { key, name, publicUrl }", () => {
    const parsed = starterSmokeDriver.inputSchema.safeParse({
      key: "starter_smoke:starter-mastra",
      name: "starter-mastra",
      publicUrl: "https://starter-mastra.up.railway.app",
    });
    expect(parsed.success).toBe(true);
  });

  it("inputSchema rejects missing publicUrl", () => {
    const parsed = starterSmokeDriver.inputSchema.safeParse({
      key: "starter_smoke:starter-mastra",
      name: "starter-mastra",
    });
    expect(parsed.success).toBe(false);
  });

  it("inputSchema rejects a non-url publicUrl", () => {
    const parsed = starterSmokeDriver.inputSchema.safeParse({
      key: "k",
      name: "starter-mastra",
      publicUrl: "not-a-url",
    });
    expect(parsed.success).toBe(false);
  });

  it("happy path: all 4 checks green → aggregate green + 4 green side rows keyed starter:<col>/<level>", async () => {
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    // mastra is a DIRECT mapping (starter slug === column slug).
    const r = (await driver.run(mkCtx(fakeFetch({}), writer), {
      key: "starter_smoke:starter-mastra",
      name: "starter-mastra",
      publicUrl: "https://starter-mastra.up.railway.app",
    })) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(r.state).toBe("green");
    expect(r.key).toBe("starter:mastra");
    expect(r.signal.columnSlug).toBe("mastra");
    expect(r.signal.starterSlug).toBe("mastra");
    expect(r.signal.passed).toBe(4);
    expect(r.signal.failed).toEqual([]);

    const rows = sideRows(writes);
    expect(rows).toHaveLength(4);
    expect(rows.map((w) => w.key)).toEqual([
      "starter:mastra/health",
      "starter:mastra/agent",
      "starter:mastra/chat",
      "starter:mastra/interaction",
    ]);
    expect(rows.every((w) => w.state === "green")).toBe(true);
  });

  it("applies the starter→column slug remap (drift case: langgraph-js → langgraph-typescript)", async () => {
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const r = (await driver.run(mkCtx(fakeFetch({}), writer), {
      key: "starter_smoke:starter-langgraph-js",
      name: "starter-langgraph-js",
      publicUrl: "https://starter-langgraph-js.up.railway.app",
    })) as ProbeResult<StarterSmokeAggregateSignal>;

    // Primary + every side row must be keyed to the COLUMN slug, not the
    // starter slug.
    expect(r.key).toBe("starter:langgraph-typescript");
    expect(r.signal.columnSlug).toBe("langgraph-typescript");
    expect(r.signal.starterSlug).toBe("langgraph-js");
    expect(sideRows(writes).map((w) => w.key)).toEqual([
      "starter:langgraph-typescript/health",
      "starter:langgraph-typescript/agent",
      "starter:langgraph-typescript/chat",
      "starter:langgraph-typescript/interaction",
    ]);
  });

  it("agent info 4xx → that level red (smoke-failed) and aggregate red", async () => {
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const r = (await driver.run(
      mkCtx(fakeFetch({ agentStatus: 404 }), writer),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(r.state).toBe("red");
    // FIX A: a 4xx agent rung yields NO usable agents map, so the chat rung
    // inherits the agent failure (it must NOT probe a guessed `default`). Both
    // rungs red, aggregate class smoke-failed.
    expect(r.signal.failed).toEqual(["agent", "chat"]);
    expect(r.signal.errorClass).toBe("smoke-failed");

    const agentRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/agent",
    )!;
    expect(agentRow.state).toBe("red");
    expect(agentRow.signal.errorClass).toBe("smoke-failed");
    // The inherited chat row is smoke-failed too, and never claims `default`.
    const chatRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/chat",
    )!;
    expect(chatRow.state).toBe("red");
    expect(chatRow.signal.errorClass).toBe("smoke-failed");
    expect(chatRow.signal.agentId).toBeUndefined();
  });

  it("agent rung FAILS on a 200 HTML body lacking `version`", async () => {
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    // A 200 `/info` that is NOT a runtime info response (e.g. an HTML error
    // shell, or a JSON body lacking `version`) must FAIL the agent rung — a
    // bare "any non-404" contract would have wrongly passed this.
    const r = (await driver.run(
      mkCtx(
        fakeFetch({ agentBody: '{"status":"ok","integration":"agno"}' }),
        writer,
      ),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(r.state).toBe("red");
    // FIX A: the 200 info lacks BOTH `version` and an `agents` map → agent rung
    // reds and the chat rung inherits (no guessed `default`).
    expect(r.signal.failed).toEqual(["agent", "chat"]);
    const agentRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/agent",
    )!;
    expect(agentRow.state).toBe("red");
    expect(agentRow.signal.errorClass).toBe("smoke-failed");
    expect(agentRow.signal.errorDesc).toContain("version");
  });

  it("agent rung FAILS on a 200 HTML body (non-JSON)", async () => {
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const r = (await driver.run(
      mkCtx(fakeFetch({ agentBody: "<html>not json</html>" }), writer),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(r.state).toBe("red");
    // FIX A: an HTML (non-JSON) info body yields no agents map → agent reds and
    // the chat rung inherits the failure.
    expect(r.signal.failed).toEqual(["agent", "chat"]);
    const agentRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/agent",
    )!;
    expect(agentRow.state).toBe("red");
    expect(agentRow.signal.errorClass).toBe("smoke-failed");
  });

  it("agent rung PASSES on a 200 `{version}` info response", async () => {
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const r = (await driver.run(
      mkCtx(
        fakeFetch({ agentBody: '{"version":"1.59.5","mode":"sse"}' }),
        writer,
      ),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(r.signal.failed).not.toContain("agent");
    const agentRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/agent",
    )!;
    expect(agentRow.state).toBe("green");
  });

  it("agent rung uses GET /api/copilotkit/info", async () => {
    const { writer } = mkWriter();
    const driver = createStarterSmokeDriver();
    const seenUrls: Partial<
      Record<"health" | "agent" | "chat" | "interaction", string>
    > = {};
    await driver.run(mkCtx(fakeFetch({ seenUrls }), writer), {
      key: "starter_smoke:starter-agno",
      name: "starter-agno",
      publicUrl: "https://starter-agno.up.railway.app",
    });
    expect(seenUrls.agent).toBe(
      "https://starter-agno.up.railway.app/api/copilotkit/info",
    );
  });

  it("chat rung FAILS on a 200 stream with no TEXT_MESSAGE_CONTENT", async () => {
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const r = (await driver.run(
      mkCtx(fakeFetch({ chatSse: SSE_NO_TEXT }), writer),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(r.state).toBe("red");
    expect(r.signal.failed).toEqual(["chat"]);
    const chatRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/chat",
    )!;
    expect(chatRow.state).toBe("red");
    expect(chatRow.signal.errorClass).toBe("smoke-failed");
    expect(chatRow.signal.errorDesc).toContain("TEXT_MESSAGE_CONTENT");
  });

  it("chat rung FAILS on a RUN_ERROR-only stream", async () => {
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const r = (await driver.run(
      mkCtx(fakeFetch({ chatSse: SSE_RUN_ERROR }), writer),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(r.state).toBe("red");
    expect(r.signal.failed).toEqual(["chat"]);
    const chatRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/chat",
    )!;
    expect(chatRow.state).toBe("red");
    expect(chatRow.signal.errorClass).toBe("smoke-failed");
    expect(chatRow.signal.errorDesc).toContain("RUN_ERROR");
  });

  it("chat rung FAILS on a 200 stream with text but NO terminal RUN_FINISHED", async () => {
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    // A stream that produces assistant text but never reaches RUN_FINISHED
    // (e.g. the connection dropped mid-run) must FAIL — a complete chat
    // round-trip requires the terminal RUN_FINISHED.
    const truncated = [
      { type: "RUN_STARTED", threadId: "t1", runId: "run-1" },
      {
        type: "TEXT_MESSAGE_START",
        messageId: "chatcmpl-x",
        role: "assistant",
      },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "chatcmpl-x", delta: "Hello" },
    ]
      .map((e) => `data: ${JSON.stringify(e)}\n\n`)
      .join("");
    const r = (await driver.run(
      mkCtx(fakeFetch({ chatSse: truncated }), writer),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(r.state).toBe("red");
    expect(r.signal.failed).toEqual(["chat"]);
    const chatRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/chat",
    )!;
    expect(chatRow.state).toBe("red");
    expect(chatRow.signal.errorClass).toBe("smoke-failed");
    expect(chatRow.signal.errorDesc).toContain("RUN_FINISHED");
  });

  it("chat rung PASSES on a stream with TEXT_MESSAGE_CONTENT + terminal RUN_FINISHED", async () => {
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const r = (await driver.run(
      mkCtx(fakeFetch({ chatSse: SSE_HAPPY }), writer),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(r.signal.failed).not.toContain("chat");
    const chatRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/chat",
    )!;
    expect(chatRow.state).toBe("green");
  });

  it("chat rung passes when the concatenated deltas reconstruct the captured reply", () => {
    // Sanity-check the fixture seed: the captured crewai-crews happy path
    // reconstructs the real assistant reply. This guards the seed against
    // accidental edits that would no longer reflect a real stream.
    expect(HAPPY_DELTAS.join("")).toBe(
      "Hello! I'm the crewai-crews AI assistant. How can I help you?",
    );
  });

  it("chat rung FAILS on a non-2xx HTTP status", async () => {
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const r = (await driver.run(mkCtx(fakeFetch({ chatStatus: 500 }), writer), {
      key: "starter_smoke:starter-agno",
      name: "starter-agno",
      publicUrl: "https://starter-agno.up.railway.app",
    })) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(r.state).toBe("red");
    expect(r.signal.failed).toEqual(["chat"]);
    const chatRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/chat",
    )!;
    expect(chatRow.state).toBe("red");
    expect(chatRow.signal.errorClass).toBe("smoke-failed");
  });

  it("resolves the chat agentId from /info agents map (mastra-shaped non-default key)", async () => {
    // A2: most starters register `agents:{default}`, but mastra registers a
    // DYNAMIC non-`default` key (`MastraAgent.getLocalAgents`). The chat rung
    // must read the FIRST key of the `/info` `agents` map and POST to
    // `/agent/<that-id>/run`, NOT the hardcoded `/agent/default/run` (which
    // 404s for mastra). Here `/info` advertises `{ weatherAgent: {...} }`, so
    // the chat POST must target `/agent/weatherAgent/run`.
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const seenUrls: Partial<
      Record<"health" | "agent" | "chat" | "interaction", string>
    > = {};
    const r = (await driver.run(
      mkCtx(
        fakeFetch({
          agentBody: JSON.stringify({
            version: "1.59.5",
            agents: { weatherAgent: { description: "weather" } },
          }),
          seenUrls,
        }),
        writer,
      ),
      {
        key: "starter_smoke:starter-mastra",
        name: "starter-mastra",
        publicUrl: "https://starter-mastra.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(seenUrls.chat).toBe(
      "https://starter-mastra.up.railway.app/api/copilotkit/agent/weatherAgent/run",
    );
    // The resolved agentId is surfaced on the chat row signal for drilldown.
    const chatRow = sideRows(writes).find(
      (w) => w.key === "starter:mastra/chat",
    )!;
    expect(chatRow.signal.agentId).toBe("weatherAgent");
    // Full round-trip still passes (the fake chat SSE is the happy stream).
    expect(chatRow.state).toBe("green");
    expect(r.signal.failed).not.toContain("chat");
  });

  it("falls back to agentId 'default' when /info agents map is empty/absent", async () => {
    // The 11 default-registering starters have `agents:{default}` (or an
    // absent/empty map in degraded info). `default` is the EXPECTED resolved
    // value for them — a last-resort fallback, not an error.
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const seenUrls: Partial<
      Record<"health" | "agent" | "chat" | "interaction", string>
    > = {};
    await driver.run(
      mkCtx(
        // info body carries a `version` but NO `agents` map.
        fakeFetch({ agentBody: '{"version":"1.59.5"}', seenUrls }),
        writer,
      ),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    );

    expect(seenUrls.chat).toBe(
      "https://starter-agno.up.railway.app/api/copilotkit/agent/default/run",
    );
    const chatRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/chat",
    )!;
    expect(chatRow.signal.agentId).toBe("default");
  });

  it("resolves the chat agentId from a default-registering /info agents map", async () => {
    // The 11 default-registering starters advertise `agents:{default}`; the
    // resolver must pick `default` (first key) and the chat POST targets
    // `/agent/default/run` — keeping the default case green.
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const seenUrls: Partial<
      Record<"health" | "agent" | "chat" | "interaction", string>
    > = {};
    await driver.run(
      mkCtx(
        fakeFetch({
          agentBody: JSON.stringify({
            version: "1.59.5",
            agents: { default: { description: "the agent" } },
          }),
          seenUrls,
        }),
        writer,
      ),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    );

    expect(seenUrls.chat).toBe(
      "https://starter-agno.up.railway.app/api/copilotkit/agent/default/run",
    );
    const chatRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/chat",
    )!;
    expect(chatRow.signal.agentId).toBe("default");
  });

  it("the chat POST targets /api/copilotkit/agent/default/run (path-based)", async () => {
    const { writer } = mkWriter();
    const driver = createStarterSmokeDriver();
    const seenUrls: Partial<
      Record<"health" | "agent" | "chat" | "interaction", string>
    > = {};
    await driver.run(mkCtx(fakeFetch({ seenUrls }), writer), {
      key: "starter_smoke:starter-agno",
      name: "starter-agno",
      publicUrl: "https://starter-agno.up.railway.app",
    });

    expect(seenUrls.chat).toBe(
      "https://starter-agno.up.railway.app/api/copilotkit/agent/default/run",
    );
    // Path-based: NO single-route envelope POST to bare `/api/copilotkit`.
    expect(seenUrls.chat!.endsWith("/api/copilotkit")).toBe(false);
  });

  it("chat POST carries X-AIMock-Context = column slug (direct map: agno)", async () => {
    // The scoped per-integration "Hello" fixture
    // (`showcase/aimock/d4/agno/chat.json` → `{userMessage:"Hello",
    // context:"agno"}`) only matches under aimock strict mode when the request
    // carries `X-AIMock-Context: agno`. The chat POST must send the column slug
    // as that header (the SAME value the integration's playwright.config.ts
    // injects), or staging aimock 503s "no fixture matched". agno is a DIRECT
    // map (starter slug === column slug === context).
    const { writer } = mkWriter();
    const driver = createStarterSmokeDriver();
    const seenHeaders: Partial<
      Record<
        "health" | "agent" | "chat" | "interaction",
        Record<string, string>
      >
    > = {};
    await driver.run(mkCtx(fakeFetch({ seenHeaders }), writer), {
      key: "starter_smoke:starter-agno",
      name: "starter-agno",
      publicUrl: "https://starter-agno.up.railway.app",
    });
    expect(seenHeaders.chat?.["x-aimock-context"]).toBe("agno");
  });

  it("chat POST carries X-AIMock-Context = COLUMN slug, not the starter slug (drift map: langgraph-js → langgraph-typescript)", async () => {
    // The trust-critical skew case: the probe slug is `langgraph-js` but the
    // fixture/playwright context is `langgraph-typescript`. The chat POST must
    // send the REMAPPED column slug, not the raw starter slug — sending
    // `langgraph-js` would 503 on staging (no such fixture context).
    const { writer } = mkWriter();
    const driver = createStarterSmokeDriver();
    const seenHeaders: Partial<
      Record<
        "health" | "agent" | "chat" | "interaction",
        Record<string, string>
      >
    > = {};
    await driver.run(mkCtx(fakeFetch({ seenHeaders }), writer), {
      key: "starter_smoke:starter-langgraph-js",
      name: "starter-langgraph-js",
      publicUrl: "https://starter-langgraph-js.up.railway.app",
    });
    expect(seenHeaders.chat?.["x-aimock-context"]).toBe("langgraph-typescript");
    // It must NOT send the un-remapped starter slug.
    expect(seenHeaders.chat?.["x-aimock-context"]).not.toBe("langgraph-js");
  });

  it("chat POST carries X-AIMock-Context = google-adk for the adk drift map", async () => {
    // Second skew: probe slug `adk` → column/context `google-adk`.
    const { writer } = mkWriter();
    const driver = createStarterSmokeDriver();
    const seenHeaders: Partial<
      Record<
        "health" | "agent" | "chat" | "interaction",
        Record<string, string>
      >
    > = {};
    await driver.run(mkCtx(fakeFetch({ seenHeaders }), writer), {
      key: "starter_smoke:starter-adk",
      name: "starter-adk",
      publicUrl: "https://starter-adk.up.railway.app",
    });
    expect(seenHeaders.chat?.["x-aimock-context"]).toBe("google-adk");
  });

  it("the X-AIMock-Context header is sent ONLY on the chat POST, never on the GET rungs", async () => {
    // The browser sends the context only on the chat turn; the GET rungs hit
    // the runtime `/info` route + the app shell, not aimock. Sending the header
    // on the GETs would be a needless deviation from what the browser does.
    const { writer } = mkWriter();
    const driver = createStarterSmokeDriver();
    const seenHeaders: Partial<
      Record<
        "health" | "agent" | "chat" | "interaction",
        Record<string, string>
      >
    > = {};
    await driver.run(mkCtx(fakeFetch({ seenHeaders }), writer), {
      key: "starter_smoke:starter-mastra",
      name: "starter-mastra",
      publicUrl: "https://starter-mastra.up.railway.app",
    });
    expect(seenHeaders.chat?.["x-aimock-context"]).toBe("mastra");
    expect(seenHeaders.health?.["x-aimock-context"]).toBeUndefined();
    expect(seenHeaders.agent?.["x-aimock-context"]).toBeUndefined();
    expect(seenHeaders.interaction?.["x-aimock-context"]).toBeUndefined();
  });

  it("chat POST still carries Content-Type + Accept alongside X-AIMock-Context", async () => {
    // Adding the context header must not drop the existing chat negotiation
    // headers (JSON body + event-stream Accept).
    const { writer } = mkWriter();
    const driver = createStarterSmokeDriver();
    const seenHeaders: Partial<
      Record<
        "health" | "agent" | "chat" | "interaction",
        Record<string, string>
      >
    > = {};
    await driver.run(mkCtx(fakeFetch({ seenHeaders }), writer), {
      key: "starter_smoke:starter-agno",
      name: "starter-agno",
      publicUrl: "https://starter-agno.up.railway.app",
    });
    expect(seenHeaders.chat?.["content-type"]).toBe("application/json");
    expect(seenHeaders.chat?.["accept"]).toBe("text/event-stream");
    expect(seenHeaders.chat?.["x-aimock-context"]).toBe("agno");
  });

  it("health rung uses GET /api/copilotkit/info and reds on non-2xx", async () => {
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const seenUrls: Partial<
      Record<"health" | "agent" | "chat" | "interaction", string>
    > = {};
    const r = (await driver.run(
      mkCtx(fakeFetch({ healthStatus: 503, seenUrls }), writer),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(seenUrls.health).toBe(
      "https://starter-agno.up.railway.app/api/copilotkit/info",
    );
    expect(r.state).toBe("red");
    expect(r.signal.failed).toEqual(["health"]);
    const healthRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/health",
    )!;
    expect(healthRow.signal.errorClass).toBe("smoke-failed");
  });

  it("transport failure (cold-start wake) → classified transport-error, NOT smoke-failed", async () => {
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const connErr = new Error("connect ECONNREFUSED");
    const r = (await driver.run(
      mkCtx(fakeFetch({ throwOn: { health: connErr } }), writer),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(r.state).toBe("red");
    expect(r.signal.failed).toEqual(["health"]);
    // A cold-start / transport hiccup must be classified distinctly so it
    // doesn't read as a hard red.
    expect(r.signal.errorClass).toBe("transport-error");
    const healthRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/health",
    )!;
    expect(healthRow.signal.errorClass).toBe("transport-error");
  });

  it("aggregate errorClass prefers smoke-failed over transport-error when both occur", async () => {
    const { writer } = mkWriter();
    const driver = createStarterSmokeDriver();
    const connErr = new Error("ETIMEDOUT");
    const r = (await driver.run(
      mkCtx(
        fakeFetch({ throwOn: { interaction: connErr }, agentStatus: 404 }),
        writer,
      ),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(r.state).toBe("red");
    // FIX A: the agent 404 yields no usable map → the chat rung inherits the
    // smoke-failed agent failure (no guessed `default`), so chat reds too.
    expect(r.signal.failed.sort()).toEqual(["agent", "chat", "interaction"]);
    // smoke-failed (agent 404, inherited by chat) is more actionable than the
    // transport hiccup on interaction, so it wins the aggregate class.
    expect(r.signal.errorClass).toBe("smoke-failed");
  });

  it("unmapped starter (no column) → red aggregate with smoke-failed class, no per-level rows", async () => {
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const r = (await driver.run(mkCtx(fakeFetch({}), writer), {
      key: "starter_smoke:starter-nonexistent",
      name: "starter-nonexistent",
      publicUrl: "https://starter-nonexistent.up.railway.app",
    })) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(r.state).toBe("red");
    expect(r.key).toBe("starter:nonexistent");
    expect(r.signal.errorClass).toBe("smoke-failed");
    // No per-level side rows when we can't resolve a column slug.
    expect(writes).toHaveLength(0);
  });

  it("emits side rows even without a writer wired (no throw)", async () => {
    const driver = createStarterSmokeDriver();
    // No writer on the ctx — driver must not throw, primary still returns.
    const r = (await driver.run(mkCtx(fakeFetch({})), {
      key: "starter_smoke:starter-mastra",
      name: "starter-mastra",
      publicUrl: "https://starter-mastra.up.railway.app",
    })) as ProbeResult<StarterSmokeAggregateSignal>;
    expect(r.state).toBe("green");
    expect(r.key).toBe("starter:mastra");
  });

  it("external abort (already-aborted ctx.abortSignal) → levels classified 'aborted'", async () => {
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    // A fetch that rejects with an AbortError, paired with an
    // already-aborted external signal: the per-check catch must classify the
    // failure as `aborted` (the outer tick was abandoned), distinct from a
    // per-endpoint `transport-error` slow wake.
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    const ctx: ProbeContext = {
      now: () => new Date("2026-06-03T00:00:00Z"),
      logger,
      env: {},
      writer,
      fetchImpl: fakeFetch({
        throwOn: {
          health: abortErr,
          agent: abortErr,
          chat: abortErr,
          interaction: abortErr,
        },
      }),
      abortSignal: AbortSignal.abort(),
    };
    const r = (await driver.run(ctx, {
      key: "starter_smoke:starter-agno",
      name: "starter-agno",
      publicUrl: "https://starter-agno.up.railway.app",
    })) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(r.state).toBe("red");
    expect(r.signal.failed.sort()).toEqual([
      "agent",
      "chat",
      "health",
      "interaction",
    ]);
    // All levels aborted → aggregate worst class is `aborted`.
    expect(r.signal.errorClass).toBe("aborted");
    const rows = sideRows(writes);
    for (const row of rows) {
      expect(row.signal.errorClass).toBe("aborted");
    }
  });

  it("mid-flight external abort + a non-abort rejection (ECONNREFUSED) on the in-flight level → transport-error (NOT aborted)", async () => {
    // F1(i): the external abortSignal latches WHILE the first check's fetch is
    // in flight, but THAT check fails for its OWN, non-abort reason (a
    // connection refusal). Re-reading the shared latched signal at catch-time
    // would mislabel it `aborted`; the class must reflect why THIS check
    // terminated → `transport-error`. (A pre-aborted signal can't exercise
    // this post-FIX-C: it short-circuits before any fetch. So we fire the
    // abort mid-flight on the first fetch — which then throws ECONNREFUSED.)
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const connErr = new Error("connect ECONNREFUSED 127.0.0.1:443");
    const controller = new AbortController();
    const ctx: ProbeContext = {
      now: () => new Date("2026-06-03T00:00:00Z"),
      logger,
      env: {},
      writer,
      fetchImpl: fakeFetch({
        // First fetch (health) latches the external signal, then throws a
        // non-abort error — proving the catch block keys on WHY this check
        // terminated, not on the latched signal.
        onFetch: (_level, count) => {
          if (count === 1) controller.abort();
        },
        throwOn: { health: connErr },
      }),
      abortSignal: controller.signal,
    };
    const r = (await driver.run(ctx, {
      key: "starter_smoke:starter-agno",
      name: "starter-agno",
      publicUrl: "https://starter-agno.up.railway.app",
    })) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(r.state).toBe("red");
    // The in-flight health check's non-abort error must NOT be classified
    // `aborted` just because the shared signal latched mid-flight.
    const healthRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/health",
    )!;
    expect(healthRow.signal.errorClass).toBe("transport-error");
    // The remaining levels short-circuit to `aborted` (FIX C).
    for (const row of sideRows(writes).filter(
      (w) => w.key !== "starter:agno/health",
    )) {
      expect(row.signal.errorClass).toBe("aborted");
    }
  });

  it("internal-timeout abort (self-timeout, no external abort) → transport-error (NOT aborted)", async () => {
    // F1(ii): an AbortError from THIS check's own setTimeout fires while NO
    // external signal latched. Re-reading a (here-absent) shared signal is the
    // wrong discriminator; what matters is that the abort was NOT externally
    // triggered → classify the self-timeout as `transport-error`, not
    // `aborted`. Distinct from the genuine-external-abort test below.
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const selfTimeoutErr = new Error("The operation was aborted");
    selfTimeoutErr.name = "AbortError";
    const r = (await driver.run(
      mkCtx(
        fakeFetch({
          throwOn: {
            health: selfTimeoutErr,
            agent: selfTimeoutErr,
            chat: selfTimeoutErr,
            interaction: selfTimeoutErr,
          },
        }),
        writer,
      ),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(r.state).toBe("red");
    expect(r.signal.errorClass).toBe("transport-error");
    const rows = sideRows(writes);
    for (const row of rows) {
      expect(row.signal.errorClass).toBe("transport-error");
    }
  });

  it("chat 200 whose body read aborts (timeout) → transport-error (NOT smoke-failed)", async () => {
    // F2: a slow cold-start SSE body that streams past the timeout aborts
    // mid-`res.text()`. safeReadBody swallows the AbortError → empty body →
    // verifyChatStream would hard-red it as `smoke-failed`. A body-read abort
    // is a transport hiccup the staleness rule should absorb, not a regression.
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const r = (await driver.run(
      mkCtx(fakeFetch({ bodyAbortOn: { chat: "self" } }), writer),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(r.state).toBe("red");
    expect(r.signal.failed).toEqual(["chat"]);
    const chatRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/chat",
    )!;
    expect(chatRow.state).toBe("red");
    expect(chatRow.signal.errorClass).toBe("transport-error");
  });

  it("chat 200 with a genuinely-empty (non-aborted) body → smoke-failed", async () => {
    // F2 counterpart: a 200 that returns a complete, EMPTY body (not aborted)
    // is a real bad response and must still hard-red as smoke-failed.
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const r = (await driver.run(mkCtx(fakeFetch({ chatSse: "" }), writer), {
      key: "starter_smoke:starter-agno",
      name: "starter-agno",
      publicUrl: "https://starter-agno.up.railway.app",
    })) as ProbeResult<StarterSmokeAggregateSignal>;

    expect(r.state).toBe("red");
    expect(r.signal.failed).toEqual(["chat"]);
    const chatRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/chat",
    )!;
    expect(chatRow.state).toBe("red");
    expect(chatRow.signal.errorClass).toBe("smoke-failed");
  });

  it("agent 200 body that RESOLVES (no abort) is validated for content, never softened", async () => {
    // FIX A direct: a normal completed agent read with a valid {version} body
    // must PASS — the success path reports completed:true unconditionally, so
    // a latched signal can never discard a resolved body.
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const r = (await driver.run(
      mkCtx(fakeFetch({ agentBody: '{"version":"9.9.9"}' }), writer),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;
    expect(r.signal.failed).not.toContain("agent");
    const agentRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/agent",
    )!;
    expect(agentRow.state).toBe("green");
  });

  it("agent 200 body that RESOLVES while the signal latches mid-flight → validated for content (NOT softened)", async () => {
    // FIX A: a resolved body must NOT be discarded just because the abort
    // signal latched a hair after `res.text()` resolved. Here the external
    // signal fires DURING the agent fetch (health already done), but the agent
    // info body RESOLVES with a valid {version} payload. The OLD success path
    // returned `aborted: signal.aborted` → wrongly softened a complete valid
    // body to transport-error. The rung must validate content and PASS.
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const controller = new AbortController();
    const ctx: ProbeContext = {
      now: () => new Date("2026-06-03T00:00:00Z"),
      logger,
      env: {},
      writer,
      fetchImpl: fakeFetch({
        agentBody: '{"version":"9.9.9"}',
        // Latch the external signal while the agent fetch (2nd call) is in
        // flight — its body still resolves cleanly.
        onFetch: (_level, count) => {
          if (count === 2) controller.abort();
        },
      }),
      abortSignal: controller.signal,
    };
    const r = (await driver.run(ctx, {
      key: "starter_smoke:starter-agno",
      name: "starter-agno",
      publicUrl: "https://starter-agno.up.railway.app",
    })) as ProbeResult<StarterSmokeAggregateSignal>;
    // agent's resolved body validated → agent green (chat/interaction
    // short-circuit aborted after the signal latched).
    const agentRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/agent",
    )!;
    expect(agentRow.state).toBe("green");
    expect(r.signal.failed).not.toContain("agent");
  });

  it("agent 200 whose body read aborts (timeout) → transport-error (NOT smoke-failed)", async () => {
    // FIX A/B: the agent rung must route a body-read abort through the shared
    // abort classification, same as chat — a slow cold-start info body that
    // streams past the timeout is a transport hiccup, not a missing-version
    // smoke-failed regression.
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const r = (await driver.run(
      mkCtx(fakeFetch({ bodyAbortOn: { agent: "self" } }), writer),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;
    expect(r.state).toBe("red");
    // FIX A: an agent body-abort yields no usable map → the chat rung inherits
    // the agent transport-error (no guessed `default` 404), so both reds are
    // SOFT transport-errors that the staleness rule can absorb.
    expect(r.signal.failed).toEqual(["agent", "chat"]);
    const agentRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/agent",
    )!;
    expect(agentRow.signal.errorClass).toBe("transport-error");
    const chatRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/chat",
    )!;
    expect(chatRow.state).toBe("red");
    expect(chatRow.signal.errorClass).toBe("transport-error");
    expect(r.signal.errorClass).toBe("transport-error");
  });

  it("health non-2xx + mid-body abort → transport-error (NOT smoke-failed)", async () => {
    // FIX B: the health rung is hit FIRST on a cold wake. A non-2xx response
    // whose body read is then cut short by our abort must route through the
    // shared abort classification, not unconditionally hard-red smoke-failed.
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const r = (await driver.run(
      mkCtx(
        fakeFetch({ healthStatus: 503, bodyAbortOn: { health: "self" } }),
        writer,
      ),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;
    expect(r.state).toBe("red");
    expect(r.signal.failed).toEqual(["health"]);
    const healthRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/health",
    )!;
    expect(healthRow.signal.errorClass).toBe("transport-error");
  });

  it("interaction non-2xx + mid-body abort → transport-error (NOT smoke-failed)", async () => {
    // FIX B (interaction rung): same shared classification as health.
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const r = (await driver.run(
      mkCtx(
        fakeFetch({
          interactionStatus: 502,
          bodyAbortOn: { interaction: "self" },
        }),
        writer,
      ),
      {
        key: "starter_smoke:starter-agno",
        name: "starter-agno",
        publicUrl: "https://starter-agno.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;
    expect(r.state).toBe("red");
    expect(r.signal.failed).toEqual(["interaction"]);
    const row = sideRows(writes).find(
      (w) => w.key === "starter:agno/interaction",
    )!;
    expect(row.signal.errorClass).toBe("transport-error");
  });

  it("mid-flight external abort short-circuits remaining levels WITHOUT extra fetches", async () => {
    // FIX C: the external signal aborts AFTER the run starts (via the
    // addEventListener path, NOT pre-aborted). It fires while the FIRST level
    // (health) fetch is in flight; that 200 still completes green, but the
    // THREE remaining levels must short-circuit to clean `aborted` rows WITHOUT
    // issuing a fresh fetch — so only ONE fetch is ever issued. Mirrors
    // d3-readiness.ts's pre-iteration `abort.signal.aborted` check.
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const controller = new AbortController();
    let fetchCount = 0;
    const ctx: ProbeContext = {
      now: () => new Date("2026-06-03T00:00:00Z"),
      logger,
      env: {},
      writer,
      fetchImpl: fakeFetch({
        onFetch: (_level, count) => {
          fetchCount = count;
          // Fire the external abort on the FIRST fetch so the remaining three
          // levels hit the pre-iteration short-circuit.
          if (count === 1) controller.abort();
        },
      }),
      abortSignal: controller.signal,
    };
    const r = (await driver.run(ctx, {
      key: "starter_smoke:starter-agno",
      name: "starter-agno",
      publicUrl: "https://starter-agno.up.railway.app",
    })) as ProbeResult<StarterSmokeAggregateSignal>;

    // Exactly ONE fetch issued — the remaining three levels short-circuited
    // WITHOUT any further fetch.
    expect(fetchCount).toBe(1);
    expect(r.state).toBe("red");
    // health (the in-flight 200) still completes green; agent/chat/interaction
    // short-circuit `aborted`.
    expect(r.signal.failed.sort()).toEqual(["agent", "chat", "interaction"]);
    expect(r.signal.errorClass).toBe("aborted");
    const rows = sideRows(writes);
    expect(rows).toHaveLength(4);
    const healthRow = rows.find((w) => w.key === "starter:agno/health")!;
    expect(healthRow.state).toBe("green");
    for (const row of rows.filter((w) => w.key !== "starter:agno/health")) {
      expect(row.state).toBe("red");
      expect(row.signal.errorClass).toBe("aborted");
    }
  });

  it("FIX A: mastra-shaped /info agents map WITHOUT a valid version → agent red, but chat does NOT POST /agent/default/run and is NOT a misleading default-404 hard red", async () => {
    // The agent rung fails its version check (info JSON has an `agents` map but
    // no `version`). The OLD code resolved `resolvedChatAgentId` ONLY on the
    // agent SUCCESS path, so the chat rung fell back to `default` and POSTed
    // `/agent/default/run` → 404 for mastra (real key `weatherAgent`) → a
    // spurious `smoke-failed` masking the real cause. The FIX must (1) resolve
    // the id from the agents map even though version validation failed, so the
    // chat rung never targets a guessed `default` for a non-default starter.
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const seenUrls: Partial<
      Record<"health" | "agent" | "chat" | "interaction", string>
    > = {};
    const r = (await driver.run(
      mkCtx(
        fakeFetch({
          // 200 info body WITH an agents map but NO `version` → agent rung reds.
          agentBody: JSON.stringify({
            agents: { weatherAgent: { description: "weather" } },
          }),
          seenUrls,
        }),
        writer,
      ),
      {
        key: "starter_smoke:starter-mastra",
        name: "starter-mastra",
        publicUrl: "https://starter-mastra.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;

    // Agent rung is red (missing version) — the real, actionable failure.
    expect(r.signal.failed).toContain("agent");
    const agentRow = sideRows(writes).find(
      (w) => w.key === "starter:mastra/agent",
    )!;
    expect(agentRow.state).toBe("red");
    expect(agentRow.signal.errorClass).toBe("smoke-failed");

    // The chat rung must NOT have POSTed to /agent/default/run (the guessed
    // default that 404s for mastra). It either targeted the resolved id or
    // skipped the fetch entirely.
    if (seenUrls.chat !== undefined) {
      expect(seenUrls.chat).not.toContain("/agent/default/run");
      expect(seenUrls.chat).toContain("/agent/weatherAgent/run");
    }
    const chatRow = sideRows(writes).find(
      (w) => w.key === "starter:mastra/chat",
    )!;
    // The chat row must NOT claim it targeted `default`.
    expect(chatRow.signal.agentId).not.toBe("default");
  });

  it("FIX A: agent rung body-abort for a mastra-shaped target → chat rung softened/inherited, NOT a default 404", async () => {
    // The agent rung's body read aborts (a slow cold-start info stream cut
    // short by the timeout). No agents map could be read, so the chat rung has
    // no resolved id. The OLD code would fall back to `default` and probe
    // `/agent/default/run` → 404 → a hard `smoke-failed` that masks the
    // transport hiccup. The FIX must carry the agent rung's transport failure
    // forward to the chat row (inherit/skip), NOT manufacture a default 404.
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const seenUrls: Partial<
      Record<"health" | "agent" | "chat" | "interaction", string>
    > = {};
    const r = (await driver.run(
      mkCtx(fakeFetch({ bodyAbortOn: { agent: "self" }, seenUrls }), writer),
      {
        key: "starter_smoke:starter-mastra",
        name: "starter-mastra",
        publicUrl: "https://starter-mastra.up.railway.app",
      },
    )) as ProbeResult<StarterSmokeAggregateSignal>;

    // Agent rung reds as a transport-error (the body-read abort).
    const agentRow = sideRows(writes).find(
      (w) => w.key === "starter:mastra/agent",
    )!;
    expect(agentRow.state).toBe("red");
    expect(agentRow.signal.errorClass).toBe("transport-error");

    // The chat rung must NOT have POSTed to /agent/default/run.
    if (seenUrls.chat !== undefined) {
      expect(seenUrls.chat).not.toContain("/agent/default/run");
    }
    const chatRow = sideRows(writes).find(
      (w) => w.key === "starter:mastra/chat",
    )!;
    expect(chatRow.state).toBe("red");
    // The chat failure must be SOFT (inherit the agent transport-error), never
    // a hard smoke-failed default-404.
    expect(chatRow.signal.errorClass).toBe("transport-error");
    // And it must not claim `default` was targeted.
    expect(chatRow.signal.agentId).not.toBe("default");
    // The aggregate worst class must be the transport hiccup, not a spurious
    // smoke-failed from a manufactured default 404.
    expect(r.signal.errorClass).toBe("transport-error");
  });

  it("FIX A: resolveAgentId prefers `default` when the agents map carries both default and a dynamic key", async () => {
    // The resolver must PREFER `default` when present (safer for multi-agent
    // starters), not blindly take the first inserted key. Here the map lists
    // `weatherAgent` FIRST, then `default`; the resolved id must be `default`.
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const seenUrls: Partial<
      Record<"health" | "agent" | "chat" | "interaction", string>
    > = {};
    await driver.run(
      mkCtx(
        fakeFetch({
          agentBody: JSON.stringify({
            version: "1.59.5",
            agents: { weatherAgent: {}, default: {} },
          }),
          seenUrls,
        }),
        writer,
      ),
      {
        key: "starter_smoke:starter-mastra",
        name: "starter-mastra",
        publicUrl: "https://starter-mastra.up.railway.app",
      },
    );
    expect(seenUrls.chat).toBe(
      "https://starter-mastra.up.railway.app/api/copilotkit/agent/default/run",
    );
    const chatRow = sideRows(writes).find(
      (w) => w.key === "starter:mastra/chat",
    )!;
    expect(chatRow.signal.agentId).toBe("default");
  });

  it("FIX C: STARTER_LEVELS orders `agent` strictly before `chat` (resolved-id invariant)", () => {
    // The whole resolved-agentId mechanism depends on the agent rung running
    // and reading `/info` BEFORE the chat rung POSTs the per-agent run path.
    expect(STARTER_LEVELS.indexOf("agent")).toBeLessThan(
      STARTER_LEVELS.indexOf("chat"),
    );
  });

  it("a writer whose write() rejects must not fail the aggregate tick (swallowed + still green)", async () => {
    // makeSideEmit must swallow a side-emit writer throw at error-level so a
    // per-row write hiccup never takes the aggregate tick down with it.
    const writeErrors: unknown[] = [];
    const throwingWriter: ProbeResultWriter = {
      async write() {
        throw new Error("simulated writer failure");
      },
    };
    const driver = createStarterSmokeDriver();
    const ctx = mkCtx(fakeFetch({}), throwingWriter);
    const r = (await driver
      .run(ctx, {
        key: "starter_smoke:starter-mastra",
        name: "starter-mastra",
        publicUrl: "https://starter-mastra.up.railway.app",
      })
      .catch((e) => {
        writeErrors.push(e);
        throw e;
      })) as ProbeResult<StarterSmokeAggregateSignal>;

    // The writer threw on every side-emit, yet the aggregate tick completed
    // and stayed green — the throw was swallowed, not propagated.
    expect(writeErrors).toHaveLength(0);
    expect(r.state).toBe("green");
    expect(r.key).toBe("starter:mastra");
    expect(r.signal.passed).toBe(STARTER_LEVELS.length);
  });
});

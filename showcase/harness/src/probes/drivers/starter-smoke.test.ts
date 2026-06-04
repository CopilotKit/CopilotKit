import { describe, it, expect } from "vitest";
import {
  createStarterSmokeDriver,
  starterSmokeDriver,
  type StarterSmokeAggregateSignal,
  type StarterSmokeLevelSignal,
} from "./starter-smoke.js";
import { logger } from "../../logger.js";
import type {
  ProbeContext,
  ProbeResult,
  ProbeResultWriter,
} from "../../types/index.js";

// Driver-level tests for the starter_smoke ProbeDriver. The Railway starter
// services don't exist yet (a separate gated slot stands them up), so every
// test injects a fake `fetchImpl` — no real network. Coverage:
//   - schema accepts the discovery shape, rejects malformed input
//   - the FOUR checks (health/agent/chat/interaction) map to the right
//     `starter:<col>/<level>` side-emit keys
//   - the starter→column slug remap is applied before emit
//   - pass → green, fail → red (smoke-failed), transport-fail → classified
//   - the aggregate primary is emitted under `starter:<col>`

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
 * Fake fetch that answers each level per the supplied opts. agent and chat
 * share the `/api/copilotkit/` URL but differ by HTTP method body, so we
 * branch on the request body to tell them apart (chat carries `messages`).
 */
function fakeFetch(opts: {
  healthStatus?: number;
  healthBody?: string;
  agentStatus?: number;
  chatStatus?: number;
  chatBody?: string;
  interactionStatus?: number;
  // When set for a level, that fetch rejects (transport failure).
  throwOn?: Partial<Record<"health" | "agent" | "chat" | "interaction", Error>>;
}): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    let level: "health" | "agent" | "chat" | "interaction";
    if (/\/api\/health/.test(href)) {
      level = "health";
    } else if (/\/api\/copilotkit/.test(href)) {
      const body = typeof init?.body === "string" ? init.body : "";
      level = body.includes("messages") ? "chat" : "agent";
    } else {
      level = "interaction";
    }

    const toThrow = opts.throwOn?.[level];
    if (toThrow) throw toThrow;

    let status: number;
    let body: string;
    if (level === "health") {
      status = opts.healthStatus ?? 200;
      body = opts.healthBody ?? '{"status":"ok"}';
    } else if (level === "agent") {
      status = opts.agentStatus ?? 200;
      body = '{"ok":true}';
    } else if (level === "chat") {
      status = opts.chatStatus ?? 200;
      body = opts.chatBody ?? '{"reply":"hello back"}';
    } else {
      status = opts.interactionStatus ?? 200;
      body = "<html><body>app shell</body></html>";
    }
    return new Response(body, { status, statusText: `HTTP ${status}` });
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

  it("agent 404 → that level red (smoke-failed) and aggregate red", async () => {
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
    expect(r.signal.failed).toEqual(["agent"]);
    expect(r.signal.errorClass).toBe("smoke-failed");

    const agentRow = sideRows(writes).find(
      (w) => w.key === "starter:agno/agent",
    )!;
    expect(agentRow.state).toBe("red");
    expect(agentRow.signal.errorClass).toBe("smoke-failed");
    expect(agentRow.signal.errorDesc).toContain("404");
  });

  it("chat with empty body → chat red (smoke-failed)", async () => {
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const r = (await driver.run(mkCtx(fakeFetch({ chatBody: "   " }), writer), {
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
    expect(chatRow.signal.errorDesc).toContain("empty response");
  });

  it("health malformed (200 but non-JSON) → health red", async () => {
    const { writer, writes } = mkWriter();
    const driver = createStarterSmokeDriver();
    const r = (await driver.run(
      mkCtx(fakeFetch({ healthBody: "<html>not json</html>" }), writer),
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
    expect(healthRow.signal.errorDesc).toContain("malformed body");
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
    expect(r.signal.failed.sort()).toEqual(["agent", "interaction"]);
    // smoke-failed (agent 404) is more actionable than the transport
    // hiccup on interaction, so it wins the aggregate class.
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
});

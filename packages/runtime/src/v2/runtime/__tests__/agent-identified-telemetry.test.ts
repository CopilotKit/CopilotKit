/**
 * `oss.runtime.agent_identified` fires from the run handler, once per agent
 * class and name per process, and never for an unknown agent. Connect never
 * contacts the agent, so it does not identify it either.
 */
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent, BaseEvent } from "@ag-ui/client";
import type { AgentCapabilities } from "@ag-ui/core";
import { Observable, of } from "rxjs";

import { createCopilotExpressHandler } from "../endpoints/express";
import { CopilotRuntime } from "../core/runtime";

type CapabilitiesFn = () => Promise<AgentCapabilities>;

/**
 * Returns a maker for agents of one fresh class. Dedupe is per agent class and
 * name for the whole process, so each test uses its own class.
 */
function agentMaker(
  getCapabilities: CapabilitiesFn = async () => ({
    identity: { type: "mastra", metadata: { adapterVersion: "2.0.3" } },
  }),
): () => AbstractAgent {
  class TestAgent {
    headers: Record<string, string> = {};
    execute = async () => ({ events: [] });
    getCapabilities = getCapabilities;
    clone() {
      return new TestAgent();
    }
  }
  return () => new TestAgent() as unknown as AbstractAgent;
}

function makeAgent(getCapabilities?: CapabilitiesFn): AbstractAgent {
  return agentMaker(getCapabilities)();
}

const runner = {
  run: () =>
    new Observable<BaseEvent>((observer) => {
      observer.next({} as BaseEvent);
      observer.complete();
      return () => undefined;
    }),
  connect: () => of({} as BaseEvent),
  isRunning: async () => false,
  stop: async () => true,
};

const runBody = () => ({
  threadId: crypto.randomUUID(),
  runId: crypto.randomUUID(),
  messages: [],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {},
});

function setup(
  agents: ConstructorParameters<typeof CopilotRuntime>[0]["agents"],
) {
  const runtime = new CopilotRuntime({ agents, runner });
  const captureSpy = vi
    .spyOn(runtime.telemetry, "capture")
    .mockResolvedValue(undefined);
  const app = express();
  app.use(createCopilotExpressHandler({ runtime, basePath: "/" }));
  const identified = () =>
    captureSpy.mock.calls.filter(
      ([event]) => event === "oss.runtime.agent_identified",
    );
  return { app, identified };
}

const callerTelemetryDisabled = process.env.COPILOTKIT_TELEMETRY_DISABLED;

describe("agent_identified from the handlers", () => {
  beforeEach(() => {
    delete process.env.COPILOTKIT_TELEMETRY_DISABLED;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (callerTelemetryDisabled === undefined) {
      delete process.env.COPILOTKIT_TELEMETRY_DISABLED;
    } else {
      process.env.COPILOTKIT_TELEMETRY_DISABLED = callerTelemetryDisabled;
    }
  });

  it("sends one agent_identified for two runs of the same agent", async () => {
    const { app, identified } = setup({ default: makeAgent() });
    await request(app).post("/agent/default/run").send(runBody());
    await request(app).post("/agent/default/run").send(runBody());
    await vi.waitFor(() => expect(identified()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(identified()).toHaveLength(1);
    expect(identified()[0][1]).toEqual({
      framework: "mastra",
      adapter_version: "2.0.3",
      via_http_agent: false,
      source: "declared",
    });
  });

  it("sends one event per agent name when agents come from a per-request factory", async () => {
    const make = agentMaker();
    const { app, identified } = setup(() => ({ default: make() }));
    await request(app).post("/agent/default/run").send(runBody());
    await request(app).post("/agent/default/run").send(runBody());
    await vi.waitFor(() => expect(identified()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(identified()).toHaveLength(1);
  });

  it("asks for capabilities with the run's forwarded headers", async () => {
    const seenHeaders: Record<string, string>[] = [];
    const headerAgent = agentMaker(
      async function (this: { headers: Record<string, string> }) {
        seenHeaders.push({ ...this.headers });
        return { identity: { type: "adk" } };
      },
    );
    const { app, identified } = setup({ default: headerAgent() });
    await request(app)
      .post("/agent/default/run")
      .set("authorization", "Bearer user-token")
      .send(runBody());
    await vi.waitFor(() => expect(identified()).toHaveLength(1));
    expect(seenHeaders[0]).toMatchObject({
      authorization: "Bearer user-token",
    });
  });

  it("sends one event when the app builds a new runtime for every request", async () => {
    const make = agentMaker();
    const getCapabilities = vi.fn(async () => ({
      identity: { type: "mastra" },
    }));
    const counts: Array<() => unknown[]> = [];
    for (let i = 0; i < 3; i++) {
      const agent = make();
      (agent as unknown as { getCapabilities: unknown }).getCapabilities =
        getCapabilities;
      const { app, identified } = setup({ default: agent });
      counts.push(identified);
      await request(app).post("/agent/default/run").send(runBody());
    }
    const total = () => counts.reduce((n, get) => n + get().length, 0);
    await vi.waitFor(() => expect(total()).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(total()).toBe(1);
  });

  it("does not identify on connect, so the first lookup carries a run's forwarded headers", async () => {
    const seenHeaders: Record<string, string>[] = [];
    const make = agentMaker(
      async function (this: { headers: Record<string, string> }) {
        seenHeaders.push({ ...this.headers });
        return { identity: { type: "adk" } };
      },
    );
    const { app, identified } = setup({ default: make() });
    await request(app)
      .post("/agent/default/connect")
      .set("authorization", "Bearer user-token")
      .send({ threadId: crypto.randomUUID(), runId: crypto.randomUUID() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(identified()).toHaveLength(0);
    expect(seenHeaders).toHaveLength(0);

    await request(app)
      .post("/agent/default/run")
      .set("authorization", "Bearer user-token")
      .send(runBody());
    await vi.waitFor(() => expect(identified()).toHaveLength(1));
    expect(seenHeaders).toEqual([
      expect.objectContaining({ authorization: "Bearer user-token" }),
    ]);
  });

  it("sends nothing and asks for no capabilities when telemetry is disabled", async () => {
    process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";
    const getCapabilities = vi.fn(async () => ({
      identity: { type: "mastra" },
    }));
    const { app, identified } = setup({ default: makeAgent(getCapabilities) });
    await request(app).post("/agent/default/run").send(runBody());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(identified()).toHaveLength(0);
    expect(getCapabilities).not.toHaveBeenCalled();
  });

  it("sends nothing for an unknown agent id", async () => {
    const { app, identified } = setup({ default: makeAgent() });
    const response = await request(app)
      .post("/agent/missing/run")
      .send(runBody());
    expect(response.status).toBe(404);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(identified()).toHaveLength(0);
  });
});

/**
 * `oss.runtime.agent_identified` fires from the run and connect handlers, once
 * per agent name per runtime, and never from a request for an unknown agent.
 */
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent, BaseEvent } from "@ag-ui/client";
import type { AgentCapabilities } from "@ag-ui/core";
import { Observable, of } from "rxjs";

import { createCopilotExpressHandler } from "../endpoints/express";
import { CopilotRuntime } from "../core/runtime";

function makeAgent(
  getCapabilities: () => Promise<AgentCapabilities> = async () => ({
    identity: { type: "mastra", metadata: { adapterVersion: "2.0.3" } },
  }),
): AbstractAgent {
  const agent: Record<string, unknown> = {
    execute: async () => ({ events: [] }),
    getCapabilities,
  };
  agent.clone = () => makeAgent(getCapabilities);
  return agent as unknown as AbstractAgent;
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
    const { app, identified } = setup(() => ({ default: makeAgent() }));
    await request(app).post("/agent/default/run").send(runBody());
    await request(app).post("/agent/default/run").send(runBody());
    await vi.waitFor(() => expect(identified()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(identified()).toHaveLength(1);
  });

  it("asks for capabilities with the run's forwarded headers", async () => {
    const seenHeaders: Record<string, string>[] = [];
    function headerAgent(): AbstractAgent {
      const agent: Record<string, unknown> = {
        headers: {},
        execute: async () => ({ events: [] }),
        async getCapabilities(this: { headers: Record<string, string> }) {
          seenHeaders.push({ ...this.headers });
          return { identity: { type: "adk" } };
        },
      };
      agent.clone = () => headerAgent();
      return agent as unknown as AbstractAgent;
    }
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

  it("sends agent_identified on connect", async () => {
    const { app, identified } = setup({ default: makeAgent() });
    await request(app)
      .post("/agent/default/connect")
      .send({ threadId: crypto.randomUUID(), runId: crypto.randomUUID() });
    await vi.waitFor(() => expect(identified()).toHaveLength(1));
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

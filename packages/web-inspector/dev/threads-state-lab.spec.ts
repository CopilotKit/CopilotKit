// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  createThreadsLabCore,
  createThreadsLabScenarioFetch,
  disposeThreadsLabCore,
  getThreadsLabScenario,
  threadsLabScenarios,
} from "./threads-state-lab.js";

const fallbackFetch = async (input: RequestInfo | URL) =>
  new Response(String(input), { status: 202 });

describe("web-inspector threads state lab scenarios", () => {
  it("models the locked state with runtime capabilities instead of fake UI", () => {
    const scenario = getThreadsLabScenario("locked");

    expect(scenario.core.threadEndpoints.list).toBe(false);
    expect(scenario.core.threadEndpoints.inspect).toBe(false);
    expect(scenario.threads).toHaveLength(0);
  });

  it("keeps enabled states backed by thread endpoint data", () => {
    const empty = getThreadsLabScenario("enabled-empty");
    const populated = getThreadsLabScenario("enabled-populated");

    expect(empty.core.threadEndpoints.list).toBe(true);
    expect(empty.threads).toHaveLength(0);
    expect(populated.core.threadEndpoints.list).toBe(true);
    expect(populated.threads.length).toBeGreaterThan(0);
  });

  it("keeps telemetry-disabled visually distinct from the enabled empty state", () => {
    const telemetryDisabled = getThreadsLabScenario("telemetry-disabled");

    expect(telemetryDisabled.core.telemetryDisabled).toBe(true);
    expect(telemetryDisabled.threads.map((thread) => thread.id)).toEqual([
      "thread-telemetry-optout",
    ]);
  });

  it("covers the audit states needed by the Inspector Threads PLG project", () => {
    expect(threadsLabScenarios.map((scenario) => scenario.key)).toEqual([
      "locked",
      "enabled-empty",
      "enabled-populated",
      "list-error",
      "telemetry-disabled",
    ]);
  });

  it("can dispose scenario thread stores when switching states", () => {
    const core = createThreadsLabCore(getThreadsLabScenario("enabled-empty"));

    expect(Object.keys(core.getThreadStores())).toEqual(["planner-agent"]);

    disposeThreadsLabCore(core);

    expect(core.getThreadStores()).toEqual({});
  });

  it("mocks thread detail endpoints for populated scenarios", async () => {
    const scenario = getThreadsLabScenario("enabled-populated");
    const scenarioFetch = createThreadsLabScenarioFetch(scenario);

    const messages = await scenarioFetch(
      `${scenario.core.runtimeUrl}/threads/thread-onboarding/messages`,
    );
    const events = await scenarioFetch(
      `${scenario.core.runtimeUrl}/threads/thread-onboarding/events`,
    );
    const state = await scenarioFetch(
      `${scenario.core.runtimeUrl}/threads/thread-onboarding/state`,
    );

    await expect(messages.json()).resolves.toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ id: "lab-user-message" }),
      ]),
    });
    await expect(events.json()).resolves.toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ type: "RUN_STARTED" }),
      ]),
    });
    await expect(state.json()).resolves.toMatchObject({
      state: expect.objectContaining({
        source: "inspector-threads-state-lab",
      }),
    });
  });

  it("keeps the enabled-empty runtime empty so production examples render", async () => {
    const scenario = getThreadsLabScenario("enabled-empty");
    const scenarioFetch = createThreadsLabScenarioFetch(scenario);

    const response = await scenarioFetch(
      `${scenario.core.runtimeUrl}/threads?agentId=planner-agent`,
    );

    await expect(response.json()).resolves.toMatchObject({
      threads: [],
    });
  });

  it("falls back for non-lab URLs so Vite assets still load", async () => {
    const scenario = getThreadsLabScenario("enabled-empty");
    const scenarioFetch = createThreadsLabScenarioFetch(
      scenario,
      fallbackFetch as typeof fetch,
    );

    const response = await scenarioFetch("/@vite/client");

    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe("/@vite/client");
  });
});

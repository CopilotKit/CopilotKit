import { AbstractAgent, EventType } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { of } from "rxjs";
import { describe, it, expect, beforeEach } from "vitest";
import { CopilotKitCore } from "../core";

/**
 * Records the input of every run and connect, so a test can read the
 * forwarded properties that reached the agent.
 */
class RecordingAgent extends AbstractAgent {
  readonly runs: RunAgentInput[] = [];
  readonly connections: RunAgentInput[] = [];

  constructor(agentId: string) {
    super({ agentId, threadId: `thread-${agentId}` });
  }

  run(input: RunAgentInput) {
    this.runs.push(input);
    return finishedRun(input);
  }

  protected connect(input: RunAgentInput) {
    this.connections.push(input);
    return finishedRun(input);
  }
}

function finishedRun(input: RunAgentInput) {
  return of(
    {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    },
    {
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
    },
  );
}

/**
 * `addScopedProperties` sends run properties only to the runs of the agents
 * it names, merged on top of `setProperties`. So the provider can attach the
 * generative UI envelope to the chat agent, and the other agents in the app
 * do not get it.
 */
describe("scoped run properties", () => {
  let core: CopilotKitCore;

  beforeEach(() => {
    core = new CopilotKitCore({});
  });

  function addAgent(agentId: string) {
    const agent = new RecordingAgent(agentId);
    core.addAgent__unsafe_dev_only({ id: agentId, agent });
    return agent;
  }

  it("forwards unscoped entries to every agent, merged over setProperties", async () => {
    core.setProperties({ tenant: "acme" });
    core.addScopedProperties({ properties: { flag: true } });
    const agent = addAgent("chat");

    await core.runAgent({ agent });

    expect(agent.runs[0]?.forwardedProps).toEqual({
      tenant: "acme",
      flag: true,
    });
  });

  it("forwards scoped entries only to runs of the named agents", async () => {
    core.addScopedProperties({
      properties: { copilotkit: { ui: { method: "a2ui" } } },
      agentIds: ["chat"],
    });
    const chat = addAgent("chat");
    const research = addAgent("research");

    await core.runAgent({ agent: chat });
    await core.runAgent({ agent: research });

    expect(chat.runs[0]?.forwardedProps).toEqual({
      copilotkit: { ui: { method: "a2ui" } },
    });
    expect(research.runs[0]?.forwardedProps).toEqual({});
  });

  it("forwards scoped entries when the named agent connects", async () => {
    core.addScopedProperties({
      properties: { copilotkit: { ui: { method: "a2ui" } } },
      agentIds: ["chat"],
    });
    const chat = addAgent("chat");
    const research = addAgent("research");

    await core.connectAgent({ agent: chat });
    await core.connectAgent({ agent: research });

    expect(chat.connections[0]?.forwardedProps).toEqual({
      copilotkit: { ui: { method: "a2ui" } },
    });
    expect(research.connections[0]?.forwardedProps).toEqual({});
  });

  it("merges plain-object values one level deep under a shared namespace", () => {
    core.setProperties({ copilotkit: { tenant: "acme" }, tags: ["a"] });
    core.addScopedProperties({
      properties: { copilotkit: { ui: { mode: "markdown" } }, tags: ["b"] },
    });

    expect(core.getPropertiesForAgent("chat")).toEqual({
      copilotkit: { tenant: "acme", ui: { mode: "markdown" } },
      tags: ["b"],
    });
  });

  it("skips agent-scoped entries when no agent id is given", () => {
    core.addScopedProperties({
      properties: { flag: true },
      agentIds: ["chat"],
    });

    expect(core.getPropertiesForAgent()).toEqual({});
  });

  it("stops forwarding an entry once it is removed", () => {
    const id = core.addScopedProperties({ properties: { flag: true } });
    expect(core.getPropertiesForAgent("chat")).toEqual({ flag: true });

    core.removeScopedProperties(id);

    expect(core.getPropertiesForAgent("chat")).toEqual({});
  });

  it("lets explicit runAgent forwardedProps win over scoped entries", async () => {
    core.addScopedProperties({ properties: { flag: true } });
    const agent = addAgent("chat");

    await core.runAgent({ agent, forwardedProps: { flag: false } });

    expect(agent.runs[0]?.forwardedProps).toEqual({ flag: false });
  });
});

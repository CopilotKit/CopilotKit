import { describe, it, expect, beforeEach } from "vitest";
import { CopilotKitCore } from "../core";
import { MockAgent } from "./test-utils";

/**
 * `addScopedProperties` forwards run properties only to runs of the agents it
 * names, merged on top of `setProperties`, so the provider can attach the
 * generative-UI envelope to the chat agent without every other agent in the
 * app receiving it.
 */
describe("scoped run properties", () => {
  let core: CopilotKitCore;

  beforeEach(() => {
    core = new CopilotKitCore({});
  });

  it("forwards unscoped entries to every agent, merged over setProperties", async () => {
    core.setProperties({ tenant: "acme" });
    core.addScopedProperties({ properties: { flag: true } });
    const agent = new MockAgent({ newMessages: [] });
    core.addAgent__unsafe_dev_only({ id: "chat", agent: agent as any });

    await core.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls[0].forwardedProps).toEqual({
      tenant: "acme",
      flag: true,
    });
  });

  it("forwards scoped entries only to the named agents", async () => {
    core.addScopedProperties({
      properties: { copilotkit: { ui: { method: "a2ui" } } },
      agentIds: ["chat"],
    });
    const chat = new MockAgent({ newMessages: [] });
    const research = new MockAgent({ newMessages: [] });
    core.addAgent__unsafe_dev_only({ id: "chat", agent: chat as any });
    core.addAgent__unsafe_dev_only({ id: "research", agent: research as any });

    await core.runAgent({ agent: chat as any });
    await core.runAgent({ agent: research as any });

    expect(chat.runAgentCalls[0].forwardedProps).toEqual({
      copilotkit: { ui: { method: "a2ui" } },
    });
    expect(research.runAgentCalls[0].forwardedProps).toEqual({});
  });

  it("merges plain-object values one level deep under a shared namespace", () => {
    core.setProperties({ copilotkit: { tenant: "acme" } });
    core.addScopedProperties({
      properties: { copilotkit: { ui: { mode: "markdown" } } },
    });

    expect(core.getPropertiesForAgent("chat")).toEqual({
      copilotkit: { tenant: "acme", ui: { mode: "markdown" } },
    });
  });

  it("stops forwarding an entry once it is removed", () => {
    const id = core.addScopedProperties({ properties: { flag: true } });
    expect(core.getPropertiesForAgent("chat")).toEqual({ flag: true });
    core.removeScopedProperties(id);
    expect(core.getPropertiesForAgent("chat")).toEqual({});
  });

  it("explicit runAgent forwardedProps win over scoped entries", async () => {
    core.addScopedProperties({ properties: { flag: true } });
    const agent = new MockAgent({ newMessages: [] });
    core.addAgent__unsafe_dev_only({ id: "chat", agent: agent as any });

    await core.runAgent({
      agent: agent as any,
      forwardedProps: { flag: false },
    });

    expect(agent.runAgentCalls[0].forwardedProps).toEqual({ flag: false });
  });
});

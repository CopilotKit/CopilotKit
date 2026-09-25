import { describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
import {
  MockAgent,
  createTool,
  createToolCallMessage,
  waitForCondition,
} from "./test-utils";

describe("Autopilot execution gate", () => {
  it("intersects Runtime activation with provider agent scope", async () => {
    const originalFetch = global.fetch;
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {};
    global.fetch = vi.fn(async () =>
      Response.json({
        version: "1.0.0",
        agents: {
          logistics: {
            name: "logistics",
            description: "Logistics",
            className: "Test",
          },
          other: { name: "other", description: "Other", className: "Test" },
        },
        mode: "intelligence",
        intelligence: { wsUrl: "wss://example.invalid" },
        autopilot: { enabled: true },
        audioFileTranscriptionEnabled: false,
      }),
    ) as typeof fetch;
    try {
      const core = new CopilotKitCore({
        runtimeUrl: "https://runtime.example/api",
        runtimeTransport: "rest",
        deferInitialConnection: true,
        autopilot: { agents: ["logistics"] },
      });
      core.connect();
      await waitForCondition(() => core.runtimeVersion === "1.0.0");
      expect(core.isAutopilotEnabledForAgent("logistics")).toBe(true);
      expect(core.isAutopilotEnabledForAgent("other")).toBe(false);
      core.setAutopilotScope({ enabled: false });
      expect(core.isAutopilotEnabledForAgent("logistics")).toBe(false);
    } finally {
      global.fetch = originalFetch;
      if (originalWindow === undefined)
        delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("blocks a named Autopilot handler while ordinary chat tools still execute", async () => {
    const core = new CopilotKitCore({});
    vi.spyOn(core, "isAutopilotEnabledForAgent").mockReturnValue(false);
    const blocked = vi.fn(async () => "changed");
    const ordinary = vi.fn(async () => "read");
    core.addTool(
      createTool({
        name: "autopilot_change",
        autopilot: true,
        handler: blocked,
        followUp: false,
      }),
    );
    core.addTool(
      createTool({ name: "ordinary", handler: ordinary, followUp: false }),
    );
    expect(
      (
        core as unknown as {
          buildFrontendTools(agentId: string): Array<{ name: string }>;
        }
      )
        .buildFrontendTools("logistics")
        .map((tool) => tool.name),
    ).toEqual(["ordinary"]);
    const agent = new MockAgent({
      agentId: "logistics",
      newMessages: [createToolCallMessage("autopilot_change")],
    });
    core.addAgent__unsafe_dev_only({ id: "logistics", agent: agent as any });
    await core.runAgent({ agent: agent as any });
    expect(blocked).not.toHaveBeenCalled();
    expect(
      agent.messages.find((message) => message.role === "tool")?.content,
    ).toContain("Autopilot is disabled");
    const ordinaryResult = await core.runTool({
      name: "ordinary",
      agentId: "logistics",
    });
    expect(ordinaryResult.error).toBeUndefined();
    expect(ordinary).toHaveBeenCalledOnce();
  });

  it("checks runTool and wildcard dispatch at the effect boundary", async () => {
    const core = new CopilotKitCore({});
    const enabled = vi
      .spyOn(core, "isAutopilotEnabledForAgent")
      .mockReturnValue(false);
    const named = vi.fn(async () => "changed");
    const wildcard = vi.fn(async () => "changed");
    core.addTool(
      createTool({
        name: "autopilot_change",
        autopilot: true,
        handler: named,
        followUp: false,
      }),
    );
    core.addTool(createTool({ name: "*", handler: wildcard, followUp: false }));
    const agent = new MockAgent({
      agentId: "logistics",
      newMessages: [createToolCallMessage("autopilot_unregistered")],
    });
    core.addAgent__unsafe_dev_only({ id: "logistics", agent: agent as any });
    const direct = await core.runTool({
      name: "autopilot_change",
      agentId: "logistics",
    });
    expect(direct.error).toContain("Autopilot is disabled");
    expect(named).not.toHaveBeenCalled();
    await core.runAgent({ agent: agent as any });
    expect(wildcard).not.toHaveBeenCalled();
    enabled.mockReturnValue(true);
    expect(
      (
        core as unknown as {
          buildFrontendTools(agentId: string): Array<{ name: string }>;
        }
      )
        .buildFrontendTools("logistics")
        .map((tool) => tool.name),
    ).toContain("autopilot_change");
    const allowed = await core.runTool({
      name: "autopilot_change",
      agentId: "logistics",
    });
    expect(allowed.error).toBeUndefined();
    expect(named).toHaveBeenCalledOnce();
  });
});

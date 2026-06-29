import { describe, it, expect, vi } from "vitest";
import { CopilotRuntime, CopilotIntelligenceRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform";
import { createBot } from "@copilotkit/bot";

const intelligence = () =>
  new CopilotKitIntelligence({
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
    apiKey: "test-key",
  });
const identifyUser = vi.fn().mockResolvedValue({ id: "u", name: "U" });

describe("CopilotRuntime — managed bots option", () => {
  it("stores declared bots on the intelligence runtime and exposes them via the facade", () => {
    const bot = createBot({ name: "support" });
    const rt = new CopilotRuntime({
      agents: {},
      intelligence: intelligence(),
      identifyUser,
      bots: [bot],
    });
    expect(rt.bots).toHaveLength(1);
    expect(rt.bots?.[0]?.name).toBe("support");
  });

  it("exposes no bots on an SSE runtime", () => {
    const rt = new CopilotRuntime({ agents: {} });
    expect(rt.bots).toBeUndefined();
  });

  it("defaults to an empty bots array when an intelligence runtime omits bots", () => {
    const rt = new CopilotIntelligenceRuntime({
      agents: {},
      intelligence: intelligence(),
      identifyUser,
    });
    expect(rt.bots).toEqual([]);
  });
});

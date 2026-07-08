import { describe, it, expect, vi } from "vitest";
import { CopilotRuntime, CopilotIntelligenceRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform";
import { createBot } from "@copilotkit/channels";

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

  it("throws (does not silently drop) when bots is passed without intelligence", () => {
    // The discriminated union forbids this at compile time; a JS / `as any`
    // caller would otherwise land on the SSE runtime and lose `bots` silently.
    expect(
      () =>
        new CopilotRuntime({
          agents: {},
          bots: [createBot({ name: "support" })],
        } as unknown as ConstructorParameters<typeof CopilotRuntime>[0]),
    ).toThrow(/Intelligence runtime/i);
  });

  it("throws at construction when a declared bot has no name (fail-fast)", () => {
    expect(
      () =>
        new CopilotIntelligenceRuntime({
          agents: {},
          intelligence: intelligence(),
          identifyUser,
          bots: [createBot({})],
        }),
    ).toThrow(/name/i);
  });
});

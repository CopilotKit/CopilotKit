import { describe, it, expect, vi } from "vitest";
import { CopilotRuntime, CopilotIntelligenceRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform";
import { createChannel } from "@copilotkit/channels";

const intelligence = () =>
  new CopilotKitIntelligence({
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
    apiKey: "test-key",
  });
const identifyUser = vi.fn().mockResolvedValue({ id: "u", name: "U" });

describe("CopilotRuntime — managed channels option", () => {
  it("stores declared channels on the intelligence runtime and exposes them via the facade", () => {
    const channel = createChannel({ name: "support" });
    const rt = new CopilotRuntime({
      agents: {},
      intelligence: intelligence(),
      identifyUser,
      channels: [channel],
    });
    expect(rt.channels).toHaveLength(1);
    expect(rt.channels?.[0]?.name).toBe("support");
  });

  it("exposes no channels on an SSE runtime", () => {
    const rt = new CopilotRuntime({ agents: {} });
    expect(rt.channels).toBeUndefined();
  });

  it("defaults to an empty channels array when an intelligence runtime omits channels", () => {
    const rt = new CopilotIntelligenceRuntime({
      agents: {},
      intelligence: intelligence(),
      identifyUser,
    });
    expect(rt.channels).toEqual([]);
  });

  it("throws (does not silently drop) when channels is passed without intelligence", () => {
    // The discriminated union forbids this at compile time; a JS / `as any`
    // caller would otherwise land on the SSE runtime and lose `channels` silently.
    expect(
      () =>
        new CopilotRuntime({
          agents: {},
          channels: [createChannel({ name: "support" })],
        } as unknown as ConstructorParameters<typeof CopilotRuntime>[0]),
    ).toThrow(/Intelligence runtime/i);
  });

  it("throws at construction when a declared channel has no name (fail-fast)", () => {
    expect(
      () =>
        new CopilotIntelligenceRuntime({
          agents: {},
          intelligence: intelligence(),
          identifyUser,
          channels: [createChannel({})],
        }),
    ).toThrow(/name/i);
  });
});

import { describe, it, expect, vi } from "vitest";
import {
  CopilotKitRuntime,
  CopilotKitIntelligenceRuntime,
} from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform";
import { createChannel } from "@copilotkit/channels-core";

const intelligence = () =>
  new CopilotKitIntelligence({
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
    apiKey: "test-key",
  });
const identifyUser = vi.fn().mockResolvedValue({ id: "u", name: "U" });

describe("CopilotKitRuntime — managed channels option", () => {
  it("stores declared channels on the intelligence runtime and exposes them via the facade", () => {
    const channel = createChannel({
      identifyUser: "platform",
      name: "support",
    });
    const rt = new CopilotKitRuntime({
      agents: {},
      intelligence: intelligence(),
      identifyUser,
      channels: [channel],
    });
    expect(rt.channels).toHaveLength(1);
    expect(rt.channels?.[0]?.name).toBe("support");
  });

  it("exposes no channels on an SSE runtime", () => {
    const rt = new CopilotKitRuntime({ agents: {} });
    expect(rt.channels).toBeUndefined();
  });

  it("defaults to an empty channels array when an intelligence runtime omits channels", () => {
    const rt = new CopilotKitIntelligenceRuntime({
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
        new CopilotKitRuntime({
          agents: {},
          channels: [
            createChannel({ identifyUser: "platform", name: "support" }),
          ],
        } as unknown as ConstructorParameters<typeof CopilotKitRuntime>[0]),
    ).toThrow(/Intelligence runtime/i);
  });

  it("throws at construction when a declared channel has no name (fail-fast)", () => {
    expect(
      () =>
        new CopilotKitIntelligenceRuntime({
          agents: {},
          intelligence: intelligence(),
          identifyUser,
          channels: [createChannel({ identifyUser: "platform" })],
        }),
    ).toThrow(/name/i);
  });
});

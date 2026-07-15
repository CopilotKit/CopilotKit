import { describe, it, expect, vi } from "vitest";
import { CopilotRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform";
import { createChannel } from "@copilotkit/channels";

const intelligence = () =>
  new CopilotKitIntelligence({
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
    apiKey: "test-key",
  });
const identifyUser = vi.fn().mockResolvedValue({ id: "u", name: "U" });

describe("CopilotRuntime — channels option", () => {
  it("intelligence runtime exposes declared channels", () => {
    const ch = createChannel({ name: "support" });
    const rt = new CopilotRuntime({
      agents: {},
      intelligence: intelligence(),
      identifyUser,
      channels: [ch],
    });
    expect(rt.channels).toEqual([ch]);
  });

  it("sse runtime rejects channels", () => {
    const ch = createChannel({ name: "support" });
    expect(
      () =>
        new CopilotRuntime({
          agents: {},
          channels: [ch],
        } as unknown as ConstructorParameters<typeof CopilotRuntime>[0]),
    ).toThrow(/Intelligence/);
  });
});

import { describe, it, expect, vi } from "vitest";
import { CopilotRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform";
import { createChannel } from "@copilotkit/channels";
import { resolveIntelligenceUser } from "../handlers/shared/resolve-intelligence-user";

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

describe("Channel-only runtimes and identifyUser (OSS-643)", () => {
  it("constructs a Channel-only Intelligence runtime with no identifyUser", () => {
    expect(
      () =>
        new CopilotRuntime({
          agents: {},
          intelligence: intelligence(),
          channels: [createChannel({ name: "support-bot" })],
        } as never),
    ).not.toThrow();
  });

  it("still rejects an Intelligence runtime with neither identifyUser nor channels", () => {
    // Omitting it without channels is a misconfiguration, not a Channel-only
    // runtime — fail at construction rather than on the first request.
    expect(
      () =>
        new CopilotRuntime({
          agents: {},
          intelligence: intelligence(),
        } as never),
    ).toThrow(/identifyUser/);
  });

  it("rejects an empty channels array as Channel-only", () => {
    expect(
      () =>
        new CopilotRuntime({
          agents: {},
          intelligence: intelligence(),
          channels: [],
        } as never),
    ).toThrow(/identifyUser/);
  });

  it("returns an actionable 500 for an HTTP Intelligence request with no identifyUser", async () => {
    const runtime = new CopilotRuntime({
      agents: {},
      intelligence: intelligence(),
      channels: [createChannel({ name: "support-bot" })],
    } as never);
    const result = await resolveIntelligenceUser({
      runtime: runtime as never,
      request: new Request("http://localhost/run", { method: "POST" }),
    });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(500);
    await expect((result as Response).json()).resolves.toMatchObject({
      error: expect.stringMatching(/identifyUser/),
    });
  });
});

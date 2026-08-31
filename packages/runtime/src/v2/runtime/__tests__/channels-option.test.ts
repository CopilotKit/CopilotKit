import { describe, it, expect, vi } from "vitest";
import { CopilotRuntime } from "../core/runtime";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import { CopilotKitIntelligence } from "../intelligence-platform";
import { createChannel } from "@copilotkit/channels";
import { InMemoryAgentRunner } from "../runner/in-memory";

const intelligence = () =>
  new CopilotKitIntelligence({
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
    apiKey: "test-key",
  });
const identifyUser = vi.fn().mockResolvedValue({ id: "u", name: "U" });

describe("CopilotRuntime — channels option", () => {
  it("intelligence runtime exposes declared channels", () => {
    const ch = createChannel({ identifyUser: "platform", name: "support" });
    const rt = new CopilotRuntime({
      agents: {},
      intelligence: intelligence(),
      identifyUser,
      channels: [ch],
    });
    expect(rt.channels).toEqual([ch]);
  });

  it("accepts a Channels-only Intelligence runtime", () => {
    const ch = createChannel({ identifyUser: "platform", name: "support" });
    const rt = new CopilotRuntime({
      agents: {},
      intelligence: intelligence(),
      channels: [ch],
    });

    expect(rt.channels).toEqual([ch]);
    expect(rt.identifyUser).toBeUndefined();
  });

  it("copies the declared Channel list during construction", () => {
    const ch = createChannel({ identifyUser: "platform", name: "support" });
    const channels: [typeof ch] = [ch];
    const rt = new CopilotRuntime({
      agents: {},
      intelligence: intelligence(),
      channels,
    });

    channels.pop();
    expect(rt.channels).toHaveLength(1);
    expect(rt.channels?.[0]).toBe(ch);
  });

  it("web Memory configuration exposes both agent policy and client routes", () => {
    const access = vi.fn().mockReturnValue({
      user: "read-write",
      project: "read",
    });
    const rt = new CopilotRuntime({
      agents: {},
      intelligence: intelligence(),
      identifyUser,
      memory: { access },
    });

    expect(rt.memory).toEqual({ access });
    expect(rt.exposeMemoryRoutes).toBe(true);
  });

  it.each([
    { agents: {}, intelligence: intelligence() },
    { agents: {}, intelligence: intelligence(), channels: [] },
    {
      agents: {},
      intelligence: intelligence(),
      identifyUser: "not-a-callback",
    },
    {
      agents: {},
      intelligence: intelligence(),
      identifyUser,
      memory: { access: "not-a-callback" },
    },
  ])("rejects an Intelligence runtime with no valid surface", (options) => {
    expect(
      () =>
        new CopilotRuntime(
          options as unknown as ConstructorParameters<typeof CopilotRuntime>[0],
        ),
    ).toThrow(/identifyUser|Channel|surface|memory/i);
  });

  it("hides every functional web route for a Channels-only runtime", async () => {
    const runtime = new CopilotRuntime({
      agents: { hidden: {} as never },
      intelligence: intelligence(),
      transcriptionService: {} as never,
      exposeMemoryRoutes: true,
      channels: [createChannel({ identifyUser: "platform", name: "support" })],
    });
    const handler = createCopilotRuntimeHandler({
      runtime,
      activateChannels: false,
    });
    const routes: Array<[string, string]> = [
      ["POST", "/agent/hidden/run"],
      ["POST", "/agent/hidden/suggest"],
      ["POST", "/agent/hidden/connect"],
      ["POST", "/agent/hidden/stop/thread-1"],
      ["POST", "/transcribe"],
      ["GET", "/threads"],
      ["POST", "/threads/subscribe"],
      ["GET", "/threads/thread-1/messages"],
      ["GET", "/threads/thread-1/events"],
      ["GET", "/threads/thread-1/state"],
      ["PATCH", "/threads/thread-1"],
      ["POST", "/threads/thread-1/archive"],
      ["GET", "/memories"],
      ["POST", "/memories/recall"],
      ["POST", "/memories/subscribe"],
      ["POST", "/annotate"],
    ];

    for (const [method, path] of routes) {
      const response = await handler(
        new Request(`http://runtime.test${path}`, { method }),
      );
      expect(response.status, `${method} ${path}`).toBe(404);
    }

    const infoResponse = await handler(
      new Request("http://runtime.test/info", { method: "GET" }),
    );
    expect(infoResponse.status).toBe(200);
    await expect(infoResponse.json()).resolves.toMatchObject({
      agents: {},
      audioFileTranscriptionEnabled: false,
      suggestions: false,
      threadEndpoints: {
        list: false,
        inspect: false,
        mutations: false,
        realtimeMetadata: false,
      },
    });
  });

  it("intelligence runtime rejects a caller-supplied runner", () => {
    expect(
      () =>
        new CopilotRuntime({
          agents: {},
          intelligence: intelligence(),
          identifyUser,
          runner: new InMemoryAgentRunner(),
        } as unknown as ConstructorParameters<typeof CopilotRuntime>[0]),
    ).toThrow(/runner/);
  });

  it("intelligence runtime tolerates an explicitly undefined runner", () => {
    const rt = new CopilotRuntime({
      agents: {},
      intelligence: intelligence(),
      identifyUser,
      runner: undefined,
    } as unknown as ConstructorParameters<typeof CopilotRuntime>[0]);

    expect(rt.runner).toBeDefined();
  });

  it("sse runtime rejects channels", () => {
    const ch = createChannel({ identifyUser: "platform", name: "support" });
    expect(
      () =>
        new CopilotRuntime({
          agents: {},
          channels: [ch],
        } as unknown as ConstructorParameters<typeof CopilotRuntime>[0]),
    ).toThrow(/Intelligence/);
  });
});

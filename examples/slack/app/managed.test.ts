import { afterEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  const stop = vi.fn(async () => {
    throw new Error("stop failed");
  });
  return {
    stop,
    closeBrowser: vi.fn(async () => {}),
    startChannelsOverRealtimeGateway: vi.fn(async () => ({ stop })),
    bot: {
      onMention: vi.fn(),
      onModalSubmit: vi.fn(),
      onThreadStarted: vi.fn(),
    },
  };
});

vi.mock("@copilotkit/channels", () => ({
  createChannel: vi.fn(() => fakes.bot),
}));
vi.mock("@copilotkit/channels-slack", () => ({
  defaultSlackTools: [],
  defaultSlackContext: [],
  SanitizingHttpAgent: function SanitizingHttpAgent() {},
}));
vi.mock("@copilotkit/channels-intelligence", () => ({
  startChannelsOverRealtimeGateway: fakes.startChannelsOverRealtimeGateway,
}));
vi.mock("./tools/index.js", () => ({ appTools: [] }));
vi.mock("./context/app-context.js", () => ({ appContext: [] }));
vi.mock("./commands/index.js", () => ({ appCommands: [] }));
vi.mock("./sender-context.js", () => ({ senderContext: vi.fn() }));
vi.mock("./modals/file-issue.js", () => ({
  fileIssueSubmit: vi.fn(),
  FILE_ISSUE_CALLBACK: "file-issue",
}));
vi.mock("./render/browser.js", () => ({ closeBrowser: fakes.closeBrowser }));

const envKeys = [
  "AGENT_URL",
  "INTELLIGENCE_PROJECT_ID",
  "INTELLIGENCE_CHANNEL_NAME",
  "INTELLIGENCE_GATEWAY_WS_URL",
  "INTELLIGENCE_API_KEY",
  "INTELLIGENCE_ORG_ID",
  "INTELLIGENCE_CHANNEL_ID",
] as const;

describe("channel entrypoint shutdown", () => {
  const previousEnv = new Map<string, string | undefined>();

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of envKeys) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previousEnv.clear();
  });

  it("exits nonzero when stopping the channel runtime fails", async () => {
    for (const key of envKeys) previousEnv.set(key, process.env[key]);
    process.env.AGENT_URL = "http://agent.test/run";
    process.env.INTELLIGENCE_PROJECT_ID = "7";
    process.env.INTELLIGENCE_CHANNEL_NAME = "opentag";
    process.env.INTELLIGENCE_GATEWAY_WS_URL = "wss://gateway.test/runner";
    process.env.INTELLIGENCE_API_KEY = "cpk-test";
    process.env.INTELLIGENCE_ORG_ID = "org_1";
    process.env.INTELLIGENCE_CHANNEL_ID = "channel_1";

    let sigterm: (() => void) | undefined;
    vi.spyOn(process, "on").mockImplementation(((event, listener) => {
      if (event === "SIGTERM") sigterm = listener as () => void;
      return process;
    }) as typeof process.on);
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined as never) as typeof process.exit);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await import("./managed.js");
    await vi.waitFor(() => expect(sigterm).toBeTypeOf("function"));
    expect(fakes.startChannelsOverRealtimeGateway).toHaveBeenCalledWith(
      [fakes.bot],
      expect.objectContaining({
        scope: expect.objectContaining({
          channelId: "channel_1",
          channelName: "opentag",
        }),
      }),
    );
    sigterm!();
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());

    expect(fakes.stop).toHaveBeenCalledOnce();
    expect(fakes.closeBrowser).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

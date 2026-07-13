import { afterEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  const stop = vi.fn(async () => {
    throw new Error("stop failed");
  });
  // The Node listener is a callable object carrying `.channels` (the shutdown
  // surface), mirroring the real `createCopilotNodeListener` return.
  const listener = Object.assign(vi.fn(), { channels: { stop } });
  return {
    stop,
    listener,
    closeBrowser: vi.fn(async () => {}),
    createCopilotNodeListener: vi.fn(() => listener),
    // Captures the options `new CopilotRuntime(...)` was constructed with so
    // the test can assert the runtime carries `channels`.
    runtimeOptions: undefined as unknown,
    CopilotRuntime: vi.fn(function CopilotRuntime(options: unknown) {
      fakes.runtimeOptions = options;
    }),
    CopilotKitIntelligence: vi.fn(function CopilotKitIntelligence() {}),
    createServer: vi.fn(() => ({
      listen: (_port: number, cb?: () => void) => {
        cb?.();
        return { close: vi.fn() };
      },
    })),
    bot: {
      onMention: vi.fn(),
      onModalSubmit: vi.fn(),
      onThreadStarted: vi.fn(),
    },
  };
});

vi.mock("node:http", () => ({ createServer: fakes.createServer }));
vi.mock("@copilotkit/channels", () => ({
  createChannel: vi.fn(() => fakes.bot),
}));
vi.mock("@copilotkit/channels-slack", () => ({
  defaultSlackTools: [],
  defaultSlackContext: [],
  SanitizingHttpAgent: function SanitizingHttpAgent() {},
}));
vi.mock("@copilotkit/runtime/v2", () => ({
  CopilotRuntime: fakes.CopilotRuntime,
  CopilotKitIntelligence: fakes.CopilotKitIntelligence,
}));
vi.mock("@copilotkit/runtime/v2/node", () => ({
  createCopilotNodeListener: fakes.createCopilotNodeListener,
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
  "COPILOTKIT_INTELLIGENCE_URL",
  "COPILOTKIT_INTELLIGENCE_WS_URL",
  "COPILOTKIT_API_KEY",
] as const;

describe("managed channel entrypoint", () => {
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

  it("mounts the normal handler over a channels-carrying runtime and stops channels on shutdown", async () => {
    for (const key of envKeys) previousEnv.set(key, process.env[key]);
    process.env.AGENT_URL = "http://agent.test/run";
    process.env.COPILOTKIT_INTELLIGENCE_URL = "http://localhost:4201";
    delete process.env.COPILOTKIT_INTELLIGENCE_WS_URL;
    process.env.COPILOTKIT_API_KEY = "cpk-test";

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

    // The listener is created from the NORMAL runtime handler — no realtime
    // gateway launcher is involved.
    expect(fakes.createCopilotNodeListener).toHaveBeenCalledWith(
      expect.objectContaining({ basePath: "/api/copilotkit" }),
    );
    // The runtime carries the Channel in `channels`.
    expect(fakes.CopilotRuntime).toHaveBeenCalledOnce();
    expect(fakes.runtimeOptions).toEqual(
      expect.objectContaining({ channels: [fakes.bot] }),
    );

    // Shutdown stops the managed Channel via listener.channels.stop().
    sigterm!();
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(fakes.stop).toHaveBeenCalledOnce();
    expect(fakes.closeBrowser).toHaveBeenCalledOnce();
    // stop() threw, so shutdown exits nonzero.
    expect(exit).toHaveBeenCalledWith(1);
  });
});

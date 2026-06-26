import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.hoisted so the spy exists before the hoisted vi.mock factory runs
// (otherwise "Cannot access 'sendSpy' before initialization").
const { sendSpy } = vi.hoisted(() => ({
  sendSpy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@copilotkit/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@copilotkit/shared")>();
  return { ...actual, lambdaClient: { send: sendSpy } };
});

import { createBot } from "../create-bot.js";
import { FakeAdapter } from "../testing/fake-adapter.js";
import { FakeAgent } from "../testing/fake-agent.js";

const waitFor = async (pred: () => boolean, ms = 1000) => {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms)
    await new Promise((r) => setTimeout(r, 10));
};

describe("oss.bot.* end-to-end (real BotTelemetry, only network boundary stubbed)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    sendSpy.mockClear();
    // Enable telemetry: clear the test-runner suppressors + any opt-out.
    delete process.env.VITEST;
    delete process.env.JEST_WORKER_ID;
    delete process.env.COPILOTKIT_TELEMETRY_DISABLED;
    delete process.env.DO_NOT_TRACK;
    process.env.NODE_ENV = "production";
    // Deliberately set NO COPILOTKIT_TELEMETRY_URL / license / API key — zero-config.
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("flows configured -> started -> agent_run with anonymous_id + bot_session_id and no env config", async () => {
    const fake = new FakeAdapter();
    const bot = createBot({ adapters: [fake], agent: () => new FakeAgent() });
    bot.onMention(async ({ thread }) => {
      await thread.runAgent();
    });
    await bot.start();
    fake.emitTurn({ userText: "hi", conversationKey: "c1" });

    await waitFor(() =>
      sendSpy.mock.calls.some((c) => c[0].event === "oss.bot.agent_run"),
    );

    const events = sendSpy.mock.calls.map((c) => c[0].event);
    expect(events).toContain("oss.bot.configured");
    expect(events).toContain("oss.bot.started");
    expect(events).toContain("oss.bot.agent_run");
    for (const [arg] of sendSpy.mock.calls) {
      expect(typeof arg.globalProperties.anonymous_id).toBe("string");
      expect(typeof arg.globalProperties.bot_session_id).toBe("string");
      expect(arg.licenseToken).toBeUndefined(); // anonymous: no license ever attached
    }
    const run = sendSpy.mock.calls.find(
      (c) => c[0].event === "oss.bot.agent_run",
    )![0];
    expect(run.properties.platform).toBe("custom"); // "fake" → normalized
    expect(typeof run.properties.durationMs).toBe("number");
  });
});

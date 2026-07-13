import { describe, it, expect, vi, beforeEach } from "vitest";

const capture = vi.fn();
vi.mock("./bot-telemetry.js", () => ({
  // A `function` (not an arrow) so `new BotTelemetry(...)` in create-channel.ts is
  // constructible under vitest's mock — an arrow implementation throws
  // "is not a constructor".
  BotTelemetry: vi.fn().mockImplementation(function () {
    return { capture };
  }),
  BOT_TELEMETRY_EVENTS: [],
}));

import { createChannel } from "../create-channel.js";
import { FakeAdapter } from "../testing/fake-adapter.js";
import { FakeAgent } from "../testing/fake-agent.js";
import { Section } from "@copilotkit/channels-ui";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createChannel telemetry wiring", () => {
  beforeEach(() => capture.mockClear());

  it("emits oss.bot.configured with a config snapshot", async () => {
    // The config snapshot is captured at start() — the backend (and therefore
    // telemetry) is resolved there, not at construction, so an adapter attached
    // via addAdapter can still provide the persistence backend.
    const bot = createChannel({
      adapters: [new FakeAdapter()],
      components: [
        function Card() {
          return Section({ children: "x" });
        },
      ],
    });
    await bot.start();
    const call = capture.mock.calls.find((c) => c[0] === "oss.bot.configured");
    expect(call).toBeDefined();
    expect(call![1].platforms).toEqual(["custom"]); // FakeAdapter.platform "fake" → normalized
    expect(call![1].store).toBe("memory");
    expect(call![1].hasComponents).toBe(true);
  });

  it("emits oss.bot.started on start, start_failed (category only) on a throwing adapter", async () => {
    const ok = new FakeAdapter();
    const bot = createChannel({ adapters: [ok] });
    await bot.start();
    expect(
      capture.mock.calls.find((c) => c[0] === "oss.bot.started")?.[1]
        .startedCount,
    ).toBe(1);

    capture.mockClear();
    const bad = new FakeAdapter();
    bad.start = () =>
      Promise.reject(
        Object.assign(new Error("xoxb-SECRET token bad"), { code: "EAUTH" }),
      );
    const bot2 = createChannel({ adapters: [bad] });
    await bot2.start();
    const f = capture.mock.calls.find((c) => c[0] === "oss.bot.start_failed");
    expect(f).toBeDefined();
    expect(f![1].errorClass).toBe("auth");
    expect(JSON.stringify(f![1])).not.toContain("SECRET");
  });

  it("emits oss.bot.agent_run on a successful run", async () => {
    const fake = new FakeAdapter();
    const bot = createChannel({
      adapters: [fake],
      agent: () => new FakeAgent(),
    });
    bot.onMention(async ({ thread }) => {
      await thread.runAgent();
    });
    await bot.start();
    capture.mockClear();
    fake.emitTurn({ userText: "hi", conversationKey: "c1" });
    await tick();
    await tick();
    const run = capture.mock.calls.find((c) => c[0] === "oss.bot.agent_run");
    expect(run).toBeDefined();
    expect(run![1].platform).toBe("custom"); // "fake" → normalized
    expect(typeof run![1].durationMs).toBe("number");
    expect(run![1].interrupted).toBe(false);
  });
});

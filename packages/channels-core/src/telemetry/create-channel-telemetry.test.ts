import { describe, it, expect, vi, beforeEach } from "vitest";

const capture = vi.fn();
vi.mock("./channel-telemetry.js", () => ({
  // A `function` (not an arrow) so `new ChannelTelemetry(...)` in create-channel.ts is
  // constructible under vitest's mock — an arrow implementation throws
  // "is not a constructor".
  ChannelTelemetry: vi.fn().mockImplementation(function () {
    return { capture };
  }),
  CHANNEL_TELEMETRY_EVENTS: [],
}));

import { createChannel } from "../create-channel.js";
import { FakeAdapter } from "../testing/fake-adapter.js";
import { FakeAgent } from "../testing/fake-agent.js";
import { Section } from "@copilotkit/channels-ui";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createChannel telemetry wiring", () => {
  beforeEach(() => capture.mockClear());

  it("emits oss.channel.configured with a config snapshot", async () => {
    // The config snapshot is captured at start() — the backend (and therefore
    // telemetry) is resolved there, not at construction, so an adapter attached
    // via addAdapter can still provide the persistence backend.
    const channel = createChannel({
      adapters: [new FakeAdapter()],
      components: [
        function Card() {
          return Section({ children: "x" });
        },
      ],
    });
    await channel.ɵruntime.start();
    const call = capture.mock.calls.find(
      (c) => c[0] === "oss.channel.configured",
    );
    expect(call).toBeDefined();
    expect(call![1].platforms).toEqual(["custom"]); // FakeAdapter.platform "fake" → normalized
    expect(call![1].store).toBe("memory");
    expect(call![1].hasComponents).toBe(true);
  });

  it("emits oss.channel.started on start, start_failed (category only) on a throwing adapter", async () => {
    const ok = new FakeAdapter();
    const channel = createChannel({ adapters: [ok] });
    await channel.ɵruntime.start();
    expect(
      capture.mock.calls.find((c) => c[0] === "oss.channel.started")?.[1]
        .startedCount,
    ).toBe(1);

    capture.mockClear();
    const bad = new FakeAdapter();
    bad.start = () =>
      Promise.reject(
        Object.assign(new Error("xoxb-SECRET token bad"), { code: "EAUTH" }),
      );
    const bot2 = createChannel({ adapters: [bad] });
    await bot2.ɵruntime.start();
    const f = capture.mock.calls.find(
      (c) => c[0] === "oss.channel.start_failed",
    );
    expect(f).toBeDefined();
    expect(f![1].errorClass).toBe("auth");
    expect(JSON.stringify(f![1])).not.toContain("SECRET");
  });

  it("emits oss.channel.agent_run on a successful run", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      agent: new FakeAgent(),
    });
    channel.onMention(async ({ thread }) => {
      await thread.runAgent();
    });
    await channel.ɵruntime.start();
    capture.mockClear();
    fake.emitTurn({ userText: "hi", conversationKey: "c1" });
    await tick();
    await tick();
    const run = capture.mock.calls.find(
      (c) => c[0] === "oss.channel.agent_run",
    );
    expect(run).toBeDefined();
    expect(run![1].platform).toBe("custom"); // "fake" → normalized
    expect(typeof run![1].durationMs).toBe("number");
    expect(run![1].interrupted).toBe(false);
  });
});

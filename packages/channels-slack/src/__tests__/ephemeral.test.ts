import { describe, it, expect, vi } from "vitest";
import { SlackAdapter } from "../adapter.js";

describe("SlackAdapter.postEphemeral", () => {
  it("posts a native ephemeral message (usedFallback=false)", async () => {
    const adapter = new SlackAdapter({
      botToken: "xoxb",
      appToken: "xapp",
      signingSecret: "s",
    });
    const postEphemeral = vi
      .fn()
      .mockResolvedValue({ ok: true, message_ts: "5.5" });
    // @ts-expect-error inject stub
    adapter.client = { chat: { postEphemeral } };
    const ir = [{ type: "text", props: { value: "hi" } }];
    const res = await adapter.postEphemeral!(
      { channel: "C1", threadTs: "1.0" },
      { id: "U1" },
      ir,
      { fallbackToDM: false },
    );
    expect(res).toMatchObject({ ok: true, usedFallback: false });
    expect(postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C1", user: "U1", thread_ts: "1.0" }),
    );
  });

  it("accepts a string user id", async () => {
    const adapter = new SlackAdapter({
      botToken: "xoxb",
      appToken: "xapp",
      signingSecret: "s",
    });
    const postEphemeral = vi
      .fn()
      .mockResolvedValue({ ok: true, message_ts: "6.0" });
    // @ts-expect-error inject stub
    adapter.client = { chat: { postEphemeral } };
    const res = await adapter.postEphemeral!({ channel: "C2" }, "U2", [], {
      fallbackToDM: false,
    });
    expect(res).toMatchObject({ ok: true, usedFallback: false });
    expect(postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C2", user: "U2" }),
    );
    // No thread_ts when target has none.
    const args = postEphemeral.mock.calls[0]![0] as Record<string, unknown>;
    expect(args["thread_ts"]).toBeUndefined();
  });

  it("omits thread_ts when target has none", async () => {
    const adapter = new SlackAdapter({
      botToken: "xoxb",
      appToken: "xapp",
      signingSecret: "s",
    });
    const postEphemeral = vi
      .fn()
      .mockResolvedValue({ ok: true, message_ts: "7.0" });
    // @ts-expect-error inject stub
    adapter.client = { chat: { postEphemeral } };
    await adapter.postEphemeral!({ channel: "C3" }, { id: "U3" }, [], {
      fallbackToDM: false,
    });
    const args = postEphemeral.mock.calls[0]![0] as Record<string, unknown>;
    expect(args["thread_ts"]).toBeUndefined();
  });

  it("ignores fallbackToDM and always posts natively (usedFallback always false)", async () => {
    const adapter = new SlackAdapter({
      botToken: "xoxb",
      appToken: "xapp",
      signingSecret: "s",
    });
    const postEphemeral = vi
      .fn()
      .mockResolvedValue({ ok: true, message_ts: "8.0" });
    // @ts-expect-error inject stub
    adapter.client = { chat: { postEphemeral } };
    const res = await adapter.postEphemeral!(
      { channel: "C4" },
      { id: "U4" },
      [],
      { fallbackToDM: true },
    );
    expect(res).toMatchObject({ ok: true, usedFallback: false });
  });

  it("returns { ok: false, error } when the Slack API throws", async () => {
    const adapter = new SlackAdapter({
      botToken: "xoxb",
      appToken: "xapp",
      signingSecret: "s",
    });
    const postEphemeral = vi
      .fn()
      .mockRejectedValue(new Error("channel_not_found"));
    // @ts-expect-error inject stub
    adapter.client = { chat: { postEphemeral } };
    const res = await adapter.postEphemeral!(
      { channel: "C5" },
      { id: "U5" },
      [],
      { fallbackToDM: false },
    );
    expect(res).toEqual({ ok: false, error: "channel_not_found" });
  });
});

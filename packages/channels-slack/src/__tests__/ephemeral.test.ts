import { describe, it, expect } from "vitest";
import { SlackAdapter } from "../adapter.js";
import { FakeSlackConnector } from "../testing/fake-slack-connector.js";

/** A credential-free adapter with a `FakeSlackConnector` bound via `ɵbindConnector`. */
function makeAdapter() {
  const adapter = new SlackAdapter({});
  const connector = new FakeSlackConnector();
  adapter.ɵbindConnector(connector);
  return { adapter, connector };
}

describe("SlackAdapter.postEphemeral", () => {
  it("posts a native ephemeral message (usedFallback=false)", async () => {
    const { adapter, connector } = makeAdapter();
    connector.results.postEphemeral = { message_ts: "5.5" };
    const ir = [{ type: "text", props: { value: "hi" } }];
    const res = await adapter.postEphemeral!(
      { channel: "C1", threadTs: "1.0" },
      { id: "U1" },
      ir,
      { fallbackToDM: false },
    );
    expect(res).toMatchObject({ ok: true, usedFallback: false });
    expect(connector.calls[0]!.op).toBe("postEphemeral");
    expect(connector.calls[0]!.args).toMatchObject({
      channel: "C1",
      user: "U1",
      thread_ts: "1.0",
    });
  });

  it("accepts a string user id", async () => {
    const { adapter, connector } = makeAdapter();
    connector.results.postEphemeral = { message_ts: "6.0" };
    const res = await adapter.postEphemeral!({ channel: "C2" }, "U2", [], {
      fallbackToDM: false,
    });
    expect(res).toMatchObject({ ok: true, usedFallback: false });
    expect(connector.calls[0]!.args).toMatchObject({
      channel: "C2",
      user: "U2",
    });
    // No thread_ts when target has none.
    const args = connector.calls[0]!.args as Record<string, unknown>;
    expect(args["thread_ts"]).toBeUndefined();
  });

  it("omits thread_ts when target has none", async () => {
    const { adapter, connector } = makeAdapter();
    connector.results.postEphemeral = { message_ts: "7.0" };
    await adapter.postEphemeral!({ channel: "C3" }, { id: "U3" }, [], {
      fallbackToDM: false,
    });
    const args = connector.calls[0]!.args as Record<string, unknown>;
    expect(args["thread_ts"]).toBeUndefined();
  });

  it("ignores fallbackToDM and always posts natively (usedFallback always false)", async () => {
    const { adapter, connector } = makeAdapter();
    connector.results.postEphemeral = { message_ts: "8.0" };
    const res = await adapter.postEphemeral!(
      { channel: "C4" },
      { id: "U4" },
      [],
      { fallbackToDM: true },
    );
    expect(res).toMatchObject({ ok: true, usedFallback: false });
  });

  it("returns { ok: false, error } when the Slack API throws", async () => {
    const { adapter, connector } = makeAdapter();
    connector.results.throwing = {
      postEphemeral: new Error("channel_not_found"),
    };
    const res = await adapter.postEphemeral!(
      { channel: "C5" },
      { id: "U5" },
      [],
      { fallbackToDM: false },
    );
    expect(res).toEqual({ ok: false, error: "channel_not_found" });
  });
});

// packages/channels-discord/src/__tests__/ephemeral.test.ts
import { it, expect } from "vitest";
import { DiscordAdapter } from "../adapter.js";
import { FakeDiscordConnector } from "../testing/fake-discord-connector.js";

function makeAdapter() {
  const adapter = new DiscordAdapter({});
  const connector = new FakeDiscordConnector({
    sendDM: { id: "dm1", channelId: "dm-channel-1" },
  });
  adapter.ɵbindConnector(connector);
  return { adapter, connector };
}

it("DM-falls-back when fallbackToDM=true (usedFallback=true)", async () => {
  const { adapter, connector } = makeAdapter();
  const res = await adapter.postEphemeral!(
    { channelId: "C1" },
    { id: "U1" },
    [{ type: "text", props: { value: "hi" } }],
    { fallbackToDM: true },
  );
  expect(res).toMatchObject({ ok: true, usedFallback: true });
  expect(connector.calls.some((c) => c.op === "sendDM")).toBe(true);
});

it("returns null when fallbackToDM=false and no live interaction", async () => {
  const { adapter, connector } = makeAdapter();
  const res = await adapter.postEphemeral!(
    { channelId: "C1" },
    { id: "U1" },
    [{ type: "text", props: { value: "hi" } }],
    { fallbackToDM: false },
  );
  expect(res).toBeNull();
  expect(connector.calls).toHaveLength(0);
});

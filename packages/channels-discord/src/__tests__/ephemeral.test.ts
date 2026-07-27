// packages/channels-discord/src/__tests__/ephemeral.test.ts
import { describe, it, expect, vi } from "vitest";
import { DiscordAdapter } from "../adapter.js";

function makeAdapter() {
  const send = vi.fn().mockResolvedValue({ id: "dm1" });
  const client = {
    users: {
      fetch: vi.fn().mockResolvedValue({
        createDM: vi.fn().mockResolvedValue({ id: "dm-channel-1", send }),
      }),
    },
  };
  const adapter = new DiscordAdapter(
    { botToken: "t", appId: "app" },
    { client: client as any },
  );
  return { adapter, send, client };
}

it("DM-falls-back when fallbackToDM=true (usedFallback=true)", async () => {
  const { adapter, send } = makeAdapter();
  const res = await adapter.postEphemeral!(
    { channelId: "C1" },
    { id: "U1" },
    [{ type: "text", props: { value: "hi" } }],
    { fallbackToDM: true },
  );
  expect(res).toMatchObject({ ok: true, usedFallback: true });
  expect(send).toHaveBeenCalled();
});

it("returns null when fallbackToDM=false and no live interaction", async () => {
  const { adapter } = makeAdapter();
  const res = await adapter.postEphemeral!(
    { channelId: "C1" },
    { id: "U1" },
    [{ type: "text", props: { value: "hi" } }],
    { fallbackToDM: false },
  );
  expect(res).toBeNull();
});

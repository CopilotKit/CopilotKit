// packages/channels-telegram/src/__tests__/ephemeral.test.ts
import { it, expect, vi } from "vitest";
import { TelegramAdapter } from "../adapter.js";

it("DMs the user when fallbackToDM=true", async () => {
  const a = new TelegramAdapter({ token: "t" });
  const sendMessage = vi
    .fn()
    .mockResolvedValue({ message_id: 5, chat: { id: 1 } });
  // @ts-expect-error inject stub api
  a.bot = { api: { sendMessage } };
  const res = await a.postEphemeral!(
    { chatId: 99 },
    { id: "1" },
    [{ type: "text", props: { value: "hi" } }],
    { fallbackToDM: true },
  );
  expect(res).toMatchObject({ ok: true, usedFallback: true });
  expect(sendMessage).toHaveBeenCalledWith(
    "1",
    expect.any(String),
    expect.any(Object),
  );
});

it("returns null when fallbackToDM=false", async () => {
  const a = new TelegramAdapter({ token: "t" });
  const res = await a.postEphemeral!(
    { chatId: 99 },
    { id: "1" },
    [{ type: "text", props: { value: "hi" } }],
    { fallbackToDM: false },
  );
  expect(res).toBeNull();
});

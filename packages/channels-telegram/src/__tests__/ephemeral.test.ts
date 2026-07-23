// packages/channels-telegram/src/__tests__/ephemeral.test.ts
import { it, expect } from "vitest";
import { TelegramAdapter } from "../adapter.js";
import { FakeTelegramConnector } from "../testing/fake-telegram-connector.js";

/** A credential-free adapter with a `FakeTelegramConnector` bound via `ɵbindConnector`. */
function setup() {
  const a = new TelegramAdapter({});
  const connector = new FakeTelegramConnector();
  a.ɵbindConnector(connector);
  return { a, connector };
}

it("DMs the user when fallbackToDM=true", async () => {
  const { a, connector } = setup();
  const res = await a.postEphemeral!(
    { chatId: 99 },
    { id: "1" },
    [{ type: "text", props: { value: "hi" } }],
    { fallbackToDM: true },
  );
  expect(res).toMatchObject({ ok: true, usedFallback: true });
  expect(connector.calls[0]!.op).toBe("sendMessage");
  const args = connector.calls[0]!.args as { chatId: unknown; text: string };
  expect(args.chatId).toBe("1");
});

it("returns null when fallbackToDM=false", async () => {
  const { a, connector } = setup();
  const res = await a.postEphemeral!(
    { chatId: 99 },
    { id: "1" },
    [{ type: "text", props: { value: "hi" } }],
    { fallbackToDM: false },
  );
  expect(res).toBeNull();
  expect(connector.calls).toHaveLength(0);
});

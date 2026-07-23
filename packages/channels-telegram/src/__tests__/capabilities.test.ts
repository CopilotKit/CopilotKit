// packages/channels-telegram/src/__tests__/capabilities.test.ts
import { it, expect } from "vitest";
import { TelegramAdapter, TELEGRAM_ALLOWED_UPDATES } from "../adapter.js";

it("advertises reactions but not modals/native-ephemeral", () => {
  const a = new TelegramAdapter({ token: "t" });
  expect(a.capabilities.supportsReactions).toBe(true);
  expect(a.capabilities.supportsModals).toBe(false);
  expect(a.capabilities.supportsEphemeral).toBe(false);
  // No modal methods → engine gates openModal off.
  expect((a as any).openModal).toBeUndefined();
  expect((a as any).renderModal).toBeUndefined();
});

it("includes message_reaction in allowed_updates", () => {
  expect(TELEGRAM_ALLOWED_UPDATES).toContain("message_reaction");
});

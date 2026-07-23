import { describe, it, expect } from "vitest";
import * as api from "../index.js";

describe("public API", () => {
  it("exports the factory and key helpers", () => {
    for (const name of [
      "telegram",
      "TelegramAdapter",
      "renderTelegram",
      "conversationKeyOf",
      "defaultTelegramTools",
      "defaultTelegramContext",
      "telegramHtml",
      "withTelegramFormatFallback",
      "TelegramConversationStore",
      "ChunkedEditStream",
      "attachTelegramListener",
      "buildFileContentParts",
      "createRunRenderer",
      "decodeInteraction",
      "TELEGRAM_LIMITS",
      "DM_SCOPE",
    ]) {
      expect(api).toHaveProperty(name);
    }
  });
});

// packages/channels-discord/src/__tests__/modal-submit.test.ts
import { describe, it, expect } from "vitest";
import { decodeModalSubmit } from "../interaction.js";

it("decodes a modal submission's text fields by custom_id", () => {
  const interaction = {
    customId: "triage",
    channelId: "C1",
    guildId: "G1",
    user: { id: "U1", username: "ada" },
    fields: {
      fields: new Map([
        ["summary", { customId: "summary", value: "boom" }],
        ["detail", { customId: "detail", value: "ctx" }],
      ]),
    },
  };
  const evt = decodeModalSubmit(interaction);
  expect(evt).toMatchObject({
    callbackId: "triage",
    values: { summary: "boom", detail: "ctx" },
    user: { id: "U1", name: "ada" },
    conversationKey: "C1",
    replyTarget: { channelId: "C1", guildId: "G1" },
    platform: "discord",
  });
});

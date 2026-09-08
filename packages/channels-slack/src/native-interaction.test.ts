import { expect, test } from "vitest";
import { decodeInteraction } from "./interaction.js";

test.each([
  ["selected_user", "U123"],
  ["selected_users", ["U123", "U456"]],
  ["selected_conversation", "G123"],
  ["selected_conversations", ["G123", "G456"]],
  ["selected_channel", "C123"],
  ["selected_channels", ["C123", "C456"]],
  ["selected_date", "2026-08-03"],
  ["selected_time", "09:30"],
  ["selected_date_time", 1785774600],
] as const)("decodes Slack native action field %s", (field, expected) => {
  const event = decodeInteraction({
    type: "block_actions",
    channel: { id: "C1" },
    message: { ts: "1" },
    actions: [{ action_id: "ck:native", [field]: expected }],
  });

  expect(event?.value).toEqual(expected);
});

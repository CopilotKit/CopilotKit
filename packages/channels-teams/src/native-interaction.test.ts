import { expect, test } from "vitest";
import { parseCardAction } from "./interaction.js";

test("decodes Action.Execute invoke data through the normal interaction shape", () => {
  expect(
    parseCardAction({
      conversation: { id: "conv-1" },
      value: {
        action: {
          type: "Action.Execute",
          verb: "approve",
          data: {
            ckActionId: "ck:approve",
            value: { decision: "approve" },
          },
        },
      },
    }),
  ).toEqual({
    id: "ck:approve",
    value: { decision: "approve" },
  });
});

test("keeps submitted Teams input values beside routing metadata", () => {
  expect(
    parseCardAction({
      value: {
        ckActionId: "ck:submit",
        value: "save",
        customer: "Ada",
        priority: "high",
      },
    }),
  ).toEqual({
    id: "ck:submit",
    value: "save",
    values: {
      customer: "Ada",
      priority: "high",
    },
  });
});

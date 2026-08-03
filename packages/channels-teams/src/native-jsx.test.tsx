/** @jsxImportSource @copilotkit/channels-ui */
import { expect, test, vi } from "vitest";
import type { TurnContext } from "@microsoft/agents-hosting";
import { renderToIR } from "@copilotkit/channels-ui";
import type { ClickHandler } from "@copilotkit/channels-ui";
import { TeamsAdapter } from "./adapter.js";
import { Teams } from "./native.js";

test("native Teams JSX reaches sendActivity as an Adaptive Card", async () => {
  const sendActivity = vi.fn(async () => ({ id: "activity-1" }));
  const adapter = new TeamsAdapter();
  const ir = renderToIR(
    <Teams.AdaptiveCard fallbackText="Deploy approval">
      <Teams.TextBlock text="Deploy ready" wrap />
      <Teams.ActionSet>
        <Teams.Action.Submit
          key="approve"
          title="Approve"
          value={{ decision: "approve" }}
          onSubmit={{ id: "ck:approve" } as unknown as ClickHandler}
        />
      </Teams.ActionSet>
    </Teams.AdaptiveCard>,
  );

  await adapter.post(
    {
      conversationKey: "conv-1",
      context: { sendActivity } as unknown as TurnContext,
    },
    ir,
  );

  const sent = sendActivity.mock.calls[0]![0] as {
    attachments: Array<{ contentType: string; content: unknown }>;
  };
  expect(sent.attachments).toEqual([
    {
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        type: "AdaptiveCard",
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        version: "1.2",
        fallbackText: "Deploy approval",
        body: [
          {
            type: "TextBlock",
            text: "Deploy ready",
            wrap: true,
          },
          {
            type: "ActionSet",
            actions: [
              {
                type: "Action.Submit",
                title: "Approve",
                data: {
                  ckActionId: "ck:approve",
                  value: { decision: "approve" },
                },
              },
            ],
          },
        ],
      },
    },
  ]);
});

test("native Teams JSX rejects a root version below a child requirement", () => {
  const adapter = new TeamsAdapter();
  const ir = renderToIR(
    <Teams.AdaptiveCard version="1.2">
      <Teams.Badge text="Preview" />
    </Teams.AdaptiveCard>,
  );

  expect(() => adapter.render(ir)).toThrow(/Badge.*1\.5|1\.5.*Badge/);
});

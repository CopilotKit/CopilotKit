import { describe, expect, it } from "vitest";
import { renderToIR } from "@copilotkit/channels-ui";
import type { PlatformNode } from "@copilotkit/channels-ui";
import {
  Action,
  AdaptiveCard,
  Input,
  TextBlock,
  rawAdaptiveCard,
} from "../ui.js";
import { renderAdaptiveCard } from "./adaptive-card.js";

describe("Teams-native Adaptive Cards", () => {
  it("serializes native JSX directly and preserves submit data separately", () => {
    const ui = AdaptiveCard({
      children: [
        TextBlock({ text: "Deploy application", weight: "Bolder" }),
        Input.ChoiceSet({
          id: "environment",
          choices: [
            { title: "Staging", value: "staging" },
            { title: "Production", value: "production" },
          ],
        }),
        Action.Submit({
          title: "Deploy",
          data: { intent: "deploy" },
          onSubmit: async () => undefined,
        }),
      ],
    });
    const ir = renderToIR(ui);
    const submit = (ir[0]!.props.children as PlatformNode[])[2]!;
    (submit.props as unknown as { onSubmit: unknown }).onSubmit = {
      id: "ck:deploy",
    };

    expect(renderAdaptiveCard(ir)).toEqual({
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [
        { type: "TextBlock", text: "Deploy application", weight: "Bolder" },
        {
          type: "Input.ChoiceSet",
          id: "environment",
          choices: [
            { title: "Staging", value: "staging" },
            { title: "Production", value: "production" },
          ],
        },
      ],
      actions: [
        {
          type: "Action.Submit",
          title: "Deploy",
          data: {
            __copilotkit: {
              version: 1,
              actionId: "ck:deploy",
              value: { intent: "deploy" },
            },
          },
        },
      ],
    });
  });

  it("rejects duplicate and reserved native input ids", () => {
    const duplicate = renderToIR(
      AdaptiveCard({
        children: [
          Input.Text({ id: "environment" }),
          Input.Text({ id: "environment" }),
        ],
      }),
    );
    const reserved = renderToIR(
      AdaptiveCard({ children: [Input.Text({ id: "__copilotkit_value" })] }),
    );

    expect(() => renderAdaptiveCard(duplicate)).toThrow(/duplicate input id/);
    expect(() => renderAdaptiveCard(reserved)).toThrow(/reserved __copilotkit/);
  });

  it("validates raw cards without accepting executable or unsupported data", () => {
    const card = {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [],
    };
    expect(rawAdaptiveCard(card).raw).toBe(card);
    expect(() => rawAdaptiveCard({ ...card, version: "1.6" })).toThrow(
      /at most 1.5/,
    );
    expect(() =>
      rawAdaptiveCard({
        ...card,
        actions: [{ type: "Action.Execute", verb: "nope" }],
      }),
    ).toThrow(/Action.Execute/);
  });
});

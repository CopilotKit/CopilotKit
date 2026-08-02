/**
 * End-to-end coverage for `<Input onSubmit>` on Teams: render → submit →
 * dispatch → resume, driving a real `createChannel` runtime through the real
 * {@link renderAdaptiveCard} and {@link parseCardAction}.
 *
 * The four defects this locks down all lived between those two functions —
 * `renderInput` emitted no submit affordance, and `parseCardAction` discarded
 * every merged card input — so unit tests on either side alone kept passing
 * while the round-trip was broken.
 */
import { describe, it, expect } from "vitest";
import { createChannel } from "@copilotkit/channels-core";
import { FakeAdapter, FakeAgent } from "@copilotkit/channels-core/testing";
import { Actions, Button, Input } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { renderAdaptiveCard } from "./render/adaptive-card.js";
import type { AdaptiveCard } from "./render/adaptive-card.js";
import { parseCardAction } from "./interaction.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

const CONVERSATION = "19:abc@thread.tacv2";

/**
 * Everything a real Teams client does between a rendered card and the activity
 * it posts back: the user fills in each `Input.*` and taps an action, and Teams
 * merges the field values into that action's `data`.
 */
function submitCard(
  card: AdaptiveCard,
  typed: Record<string, string>,
  actionIndex = 0,
): ReturnType<typeof parseCardAction> {
  const action = card.actions?.[actionIndex];
  if (!action) throw new Error("card has no submittable action");
  const data = (action.data ?? {}) as Record<string, unknown>;
  return parseCardAction({
    conversation: { id: CONVERSATION },
    value: { ...data, ...typed },
  });
}

/** The `id` Teams will key this card's single `Input.Text` under. */
function inputFieldId(card: AdaptiveCard): string {
  const el = card.body.find((e) => e.type === "Input.Text");
  if (!el) throw new Error("card has no Input.Text");
  return el.id as string;
}

describe("<Input onSubmit> round-trip (Teams)", () => {
  it("delivers an Input-only card's typed text to the handler and resumes the waiter", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [fake],
      agent: () => new FakeAgent(),
    });

    let submitted: unknown;
    let seenValues: Record<string, unknown> | undefined;
    let choice: Promise<unknown> | undefined;
    channel.onMention(async ({ thread }) => {
      choice = thread.awaitChoice(
        Input({
          placeholder: "Why?",
          onSubmit: (ctx) => {
            submitted = ctx.action.value;
            seenValues = ctx.values;
          },
        }),
      );
    });

    await channel.ɵruntime.start();
    fake.emitTurn({ userText: "ask me", conversationKey: CONVERSATION });
    await tick();

    // Render: the card is submittable even though it holds no <Button>.
    const card = renderAdaptiveCard(fake.posted[0] as ChannelNode[]);
    expect(card.actions).toHaveLength(1);
    expect(card.actions![0]).toMatchObject({ type: "Action.Submit" });

    // Submit → dispatch.
    const field = inputFieldId(card);
    const action = submitCard(card, { [field]: "ship it" })!;
    fake.emitInteraction({
      id: action.id,
      conversationKey: CONVERSATION,
      value: action.value,
      values: action.values,
    });
    await tick();

    expect(submitted).toBe("ship it");
    expect(seenValues).toEqual({ [field]: "ship it" });
    // Resume: the HITL waiter resolves with the same text.
    await expect(choice!).resolves.toBe("ship it");
  });

  it("delivers the input's text alongside a clicked <Button>'s own value", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [fake],
      agent: () => new FakeAgent(),
    });

    let clickedValue: unknown;
    let seenValues: Record<string, unknown> | undefined;
    channel.onMention(async ({ thread }) => {
      await thread.post(
        Actions({
          children: [
            Input({ name: "reason", onSubmit: () => {} }),
            Button({
              value: { decision: "yes" },
              onClick: (ctx) => {
                clickedValue = ctx.action.value;
                seenValues = ctx.values;
              },
              children: "Approve",
            }),
          ],
        }),
      );
    });

    await channel.ɵruntime.start();
    fake.emitTurn({ userText: "decide", conversationKey: CONVERSATION });
    await tick();

    const card = renderAdaptiveCard(fake.posted[0] as ChannelNode[]);
    // The button supplies the submit, so nothing is synthesized.
    expect(card.actions).toHaveLength(1);

    const action = submitCard(card, { reason: "looks good" })!;
    fake.emitInteraction({
      id: action.id,
      conversationKey: CONVERSATION,
      value: action.value,
      values: action.values,
    });
    await tick();

    expect(clickedValue).toEqual({ decision: "yes" });
    expect(seenValues).toEqual({ reason: "looks good" });
  });

  it("delivers JSON-shaped text verbatim, never coerced", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [fake],
      agent: () => new FakeAgent(),
    });

    const received: unknown[] = [];
    channel.onMention(async ({ thread }) => {
      await thread.post(
        Input({
          onSubmit: (ctx) => {
            received.push(ctx.action.value);
          },
        }),
      );
    });

    await channel.ɵruntime.start();

    const typedInputs = ["42", "true", "null", '{"a":1}'];
    for (const [i, typed] of typedInputs.entries()) {
      fake.emitTurn({ userText: "ask", conversationKey: CONVERSATION });
      await tick();

      const card = renderAdaptiveCard(fake.posted[i] as ChannelNode[]);
      const action = submitCard(card, { [inputFieldId(card)]: typed })!;
      fake.emitInteraction({
        id: action.id,
        conversationKey: CONVERSATION,
        value: action.value,
        values: action.values,
      });
      await tick();
    }

    expect(received).toEqual(typedInputs);
  });
});

/**
 * End-to-end coverage for `<Input onSubmit>` on Teams: render → submit →
 * dispatch → resume, driving a real `createChannel` runtime through the real
 * {@link renderAdaptiveCard} and {@link parseCardAction}.
 *
 * Both defects this locks down lived between those two functions —
 * `renderInput` emitted no submit affordance, and `parseCardAction` discarded
 * every merged card input — so unit tests on either side alone kept passing
 * while the round-trip was broken.
 *
 * `submitCard` below is this suite's model of the Teams client; the same model
 * is asserted against the raw wire shape in `button-action-envelope.contract.test.ts`,
 * and the two must not disagree about what Teams sends.
 *
 * The cases below cover the synthesized submit on an input-only card, an
 * input's text arriving beside a clicked `<Button>`'s own value, JSON-shaped
 * text passing through uncoerced, and a multi-input card where only the first
 * handler-bound field dispatches while every field's text still arrives.
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

/** Every `Input.*` id on the rendered card, in body order — exactly the set of
 *  keys Teams will report for it. */
function cardInputIds(card: AdaptiveCard): string[] {
  return card.body
    .filter((el) => String(el.type ?? "").startsWith("Input."))
    .map((el) => el.id)
    .filter((id): id is string => typeof id === "string");
}

/**
 * Everything a real Teams client does between a rendered card and the activity
 * it posts back: the user fills in some of the card's inputs and taps an
 * action, and Teams merges EVERY `Input.*` on the card into that action's
 * `data`, keyed by the element's `id` — an input nobody touched still arrives,
 * as an empty string.
 *
 * The payload is therefore derived from the RENDERED card, not from `typed`:
 * a partial `typed` map is a user who left fields blank, not a card with fewer
 * fields, and only the former is a submit Teams could actually send.
 */
function submitCard(
  card: AdaptiveCard,
  typed: Record<string, string>,
  actionIndex = 0,
): ReturnType<typeof parseCardAction> {
  const action = card.actions?.[actionIndex];
  if (!action) throw new Error("card has no submittable action");
  const ids = cardInputIds(card);
  // A `typed` key that names no rendered field is a test bug: Teams could
  // never send it, and silently dropping it would assert against a submit no
  // client produces.
  for (const id of Object.keys(typed)) {
    if (!ids.includes(id)) throw new Error(`card has no input "${id}"`);
  }
  const data = (action.data ?? {}) as Record<string, unknown>;
  return parseCardAction({
    conversation: { id: CONVERSATION },
    value: {
      ...data,
      ...Object.fromEntries(ids.map((id) => [id, typed[id] ?? ""])),
    },
  });
}

/** The `id` Teams will key this card's single input under. */
function inputFieldId(card: AdaptiveCard): string {
  const ids = cardInputIds(card);
  if (ids.length !== 1) {
    throw new Error(`expected exactly one card input, got ${ids.length}`);
  }
  return ids[0]!;
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
      // The waiter settles only once the submit below is dispatched — long
      // after `onMention` returns — so it cannot be awaited here. Observe it
      // now anyway: if an earlier expectation aborts the test before the
      // assertion at the end, a rejection would otherwise escape as an
      // unhandled rejection attributed to some later test.
      void choice.catch(() => {});
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

  it("delivers every field of a two-input card, including the one left blank", async () => {
    // Adaptive Cards fires ONE action per card, so the synthesized submit binds
    // to the first handler-bound field only. The second input's handler never
    // runs — but its text must still reach the dispatched handler's `values`,
    // and a field the user skipped must arrive blank rather than vanish.
    const fake = new FakeAdapter();
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [fake],
      agent: () => new FakeAgent(),
    });

    let submitted: unknown;
    let seenValues: Record<string, unknown> | undefined;
    let secondHandlerRuns = 0;
    channel.onMention(async ({ thread }) => {
      await thread.post(
        Actions({
          children: [
            Input({
              name: "why",
              onSubmit: (ctx) => {
                submitted = ctx.action.value;
                seenValues = ctx.values;
              },
            }),
            Input({
              name: "details",
              onSubmit: () => {
                secondHandlerRuns++;
              },
            }),
          ],
        }),
      );
    });

    await channel.ɵruntime.start();
    fake.emitTurn({ userText: "ask me twice", conversationKey: CONVERSATION });
    await tick();

    const card = renderAdaptiveCard(fake.posted[0] as ChannelNode[]);
    expect(cardInputIds(card)).toEqual(["why", "details"]);
    // Two inputs, still one submit — synthesized, since neither input is a
    // dispatchable action of its own.
    expect(card.actions).toHaveLength(1);
    expect(card.actions![0]).toMatchObject({ type: "Action.Submit" });

    // The user fills the first field and taps Submit without touching the
    // second; `submitCard` reports `details` the way Teams would.
    const action = submitCard(card, { why: "ship it" })!;
    fake.emitInteraction({
      id: action.id,
      conversationKey: CONVERSATION,
      value: action.value,
      values: action.values,
    });
    await tick();

    expect(submitted).toBe("ship it");
    expect(seenValues).toEqual({ why: "ship it", details: "" });
    expect(secondHandlerRuns).toBe(0);
  });
});

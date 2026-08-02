/**
 * End-to-end coverage for `<Input onSubmit>` on Slack: render → submit →
 * dispatch → resume, driving a real `createChannel` runtime through the real
 * {@link renderBlockKit} and {@link decodeInteraction}.
 *
 * The defects this locks down lived between those two functions — `parseValue`
 * JSON-coerced user-typed text, and an `<Input>` nested in `<Actions>` was
 * dropped — so unit tests on either side alone kept passing while the
 * round-trip corrupted or lost the value.
 */
import { describe, it, expect } from "vitest";
import { createChannel } from "@copilotkit/channels-core";
import { FakeAdapter, FakeAgent } from "@copilotkit/channels-core/testing";
import { Actions, Button, Input } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import type { KnownBlock } from "@slack/types";
import { renderBlockKit } from "./render/block-kit.js";
import { decodeInteraction } from "./interaction.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

const CHANNEL = "C1";
const THREAD_TS = "100.0";

type InputBlock = {
  type: string;
  element: { type: string; action_id: string };
};

/** The `plain_text_input` elements Slack will report state for, in block order. */
function textInputs(blocks: KnownBlock[]): InputBlock[] {
  return blocks.filter(
    (b): b is KnownBlock & InputBlock =>
      (b as InputBlock).type === "input" &&
      (b as InputBlock).element?.type === "plain_text_input",
  );
}

/**
 * Everything a real Slack client does between rendered blocks and the
 * `block_actions` payload it posts back: the dispatching element fires with the
 * user's raw keystrokes, and every input still on the message rides along in
 * `state.values`.
 *
 * `nonce` distinguishes one submit from the next. The engine dedups inbound
 * interactions on `channel:messageTs:actionTs`, so reusing a nonce is how a
 * genuine duplicate delivery looks — every distinct click needs its own.
 */
function blockActions(
  blocks: KnownBlock[],
  action: { action_id: string; type: string; value?: string },
  typed: Record<string, string> = {},
  nonce = 0,
) {
  const state = {
    values: Object.fromEntries(
      textInputs(blocks).map((b, i) => [
        `block-${i}`,
        {
          [b.element.action_id]: {
            type: "plain_text_input",
            value: typed[b.element.action_id],
          },
        },
      ]),
    ),
  };
  return decodeInteraction({
    type: "block_actions",
    user: { id: "U1", name: "Ana" },
    channel: { id: CHANNEL },
    message: { ts: `111.${nonce}`, thread_ts: THREAD_TS },
    actions: [{ ...action, action_ts: `112.${nonce}` }],
    state,
  });
}

const conversationKey = `${CHANNEL}::${THREAD_TS}`;

describe("<Input onSubmit> round-trip (Slack)", () => {
  it("delivers the typed text to the handler and resumes the waiter", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [fake],
      agent: () => new FakeAgent(),
    });

    let submitted: unknown;
    let choice: Promise<unknown> | undefined;
    channel.onMention(async ({ thread }) => {
      choice = thread.awaitChoice(
        Input({
          placeholder: "Why?",
          onSubmit: (ctx) => {
            submitted = ctx.action.value;
          },
        }),
      );
    });

    await channel.ɵruntime.start();
    fake.emitTurn({ userText: "ask me", conversationKey });
    await tick();

    const blocks = renderBlockKit(fake.posted[0] as ChannelNode[]);
    const input = textInputs(blocks)[0]!;

    const evt = blockActions(blocks, {
      action_id: input.element.action_id,
      type: "plain_text_input",
      value: "ship it",
    })!;
    fake.emitInteraction(evt);
    await tick();

    expect(submitted).toBe("ship it");
    await expect(choice!).resolves.toBe("ship it");
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
      fake.emitTurn({ userText: "ask", conversationKey });
      await tick();

      const blocks = renderBlockKit(fake.posted[i] as ChannelNode[]);
      const evt = blockActions(
        blocks,
        {
          action_id: textInputs(blocks)[0]!.element.action_id,
          type: "plain_text_input",
          value: typed,
        },
        {},
        i,
      )!;
      fake.emitInteraction(evt);
      await tick();
    }

    expect(received).toEqual(typedInputs);
  });

  it("renders an <Input> nested in <Actions> and delivers its text to a clicked <Button>", async () => {
    // <Button> must be inside <Actions>, so this is the only JSX shape that can
    // put the two side by side — and it is the shape Slack used to silently
    // drop while Teams rendered it.
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
            Input({ onSubmit: () => {} }),
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
    fake.emitTurn({ userText: "decide", conversationKey });
    await tick();

    const blocks = renderBlockKit(fake.posted[0] as ChannelNode[]);
    const input = textInputs(blocks)[0];
    expect(input).toBeDefined();

    const button = fake.posted[0]!.flatMap((n) =>
      ((n.props?.children ?? []) as ChannelNode[]).filter(
        (c) => c.type === "button",
      ),
    )[0]!;
    const buttonId = (button.props.onClick as { id: string }).id;

    const evt = blockActions(
      blocks,
      {
        action_id: buttonId,
        type: "button",
        value: JSON.stringify({ decision: "yes" }),
      },
      { [input!.element.action_id]: "looks good" },
    )!;
    fake.emitInteraction(evt);
    await tick();

    expect(clickedValue).toEqual({ decision: "yes" });
    expect(seenValues).toEqual({ [input!.element.action_id]: "looks good" });
  });
});

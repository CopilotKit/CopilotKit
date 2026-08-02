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
import { Actions, Button, Input, Select } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import type { KnownBlock } from "@slack/types";
import { renderBlockKit } from "./render/block-kit.js";
import { decodeInteraction } from "./interaction.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

const CHANNEL = "C1";
const THREAD_TS = "100.0";

type StateElement = { type: string; action_id: string };

/**
 * How Slack reports one element's current reading, per element type. `entered`
 * is what the user put in; absent means untouched, which Slack reports as an
 * explicit empty reading (`null` for a text input, `null` for an unmade single
 * choice, `[]` for a multi-select) — never as a missing key. Keying off this
 * table is also what decides which elements appear in `state.values` at all: a
 * `<Button>` holds no state, so Slack lists none for it.
 */
const REPORTED_STATE: Record<
  string,
  (entered: string | string[] | undefined) => object
> = {
  plain_text_input: (entered) => ({
    type: "plain_text_input",
    value: entered ?? null,
  }),
  static_select: (entered) => ({
    type: "static_select",
    selected_option: entered === undefined ? null : { value: String(entered) },
  }),
  multi_static_select: (entered) => ({
    type: "multi_static_select",
    selected_options:
      entered === undefined ? [] : [entered].flat().map((value) => ({ value })),
  }),
};

/**
 * The stateful elements of the rendered message, grouped the way `state.values`
 * groups them: block → element. The renderer puts them in exactly two places —
 * an `input` block's `element` and an `actions` block's `elements`.
 *
 * The renderer leaves `block_id` to Slack, so these stand in for the ids Slack
 * would generate; only the grouping they express is load-bearing.
 */
function statefulBlocks(
  blocks: KnownBlock[],
): { id: string; elements: StateElement[] }[] {
  return blocks
    .map((block, i) => {
      const b = block as { element?: StateElement; elements?: StateElement[] };
      const candidates = b.element ? [b.element] : (b.elements ?? []);
      return {
        id: `block-${i}`,
        elements: candidates.filter((el) => el && el.type in REPORTED_STATE),
      };
    })
    .filter((b) => b.elements.length > 0);
}

/** Every element Slack will report state for, flattened, in block order. */
function statefulElements(blocks: KnownBlock[]): StateElement[] {
  return statefulBlocks(blocks).flatMap((b) => b.elements);
}

/** The `plain_text_input` elements Slack will report state for, in block order. */
function textInputs(blocks: KnownBlock[]): StateElement[] {
  return statefulElements(blocks).filter(
    (el) => el.type === "plain_text_input",
  );
}

/**
 * Everything a real Slack client does between rendered blocks and the
 * `block_actions` payload it posts back: the dispatching element fires with the
 * user's raw keystrokes, and every stateful element still on the message — the
 * dispatching one included — reports its current reading in `state.values`.
 *
 * `entered` is what the user put into the OTHER controls, keyed by action id;
 * anything left out is reported the way Slack reports an untouched control. The
 * dispatching control's reading is taken from `action` rather than from
 * `entered`, because Slack cannot post a payload in which the two disagree
 * about the control the user just used.
 *
 * `nonce` distinguishes one submit from the next. The engine dedups inbound
 * interactions on `channel:messageTs:actionTs`, so reusing a nonce is how a
 * genuine duplicate delivery looks — every distinct click needs its own.
 */
function blockActions(
  blocks: KnownBlock[],
  action: { action_id: string; type: string; value?: string },
  entered: Record<string, string | string[]> = {},
  nonce = 0,
) {
  const readingOf = (el: StateElement) =>
    el.action_id === action.action_id ? action.value : entered[el.action_id];
  const state = {
    values: Object.fromEntries(
      statefulBlocks(blocks).map((block) => [
        block.id,
        Object.fromEntries(
          block.elements.map((el) => [
            el.action_id,
            REPORTED_STATE[el.type]!(readingOf(el)),
          ]),
        ),
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
    fake.emitTurn({ userText: "ask me", conversationKey });
    await tick();

    const blocks = renderBlockKit(fake.posted[0] as ChannelNode[]);
    const input = textInputs(blocks)[0]!;

    const evt = blockActions(blocks, {
      action_id: input.action_id,
      type: "plain_text_input",
      value: "ship it",
    })!;
    fake.emitInteraction(evt);
    await tick();

    expect(submitted).toBe("ship it");
    // The submitting input reports its own text in `state.values` as well, so
    // both accessors must hand the handler the same string for one control.
    expect(seenValues).toEqual({ [input.action_id]: "ship it" });
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
    const echoedInValues: unknown[] = [];
    channel.onMention(async ({ thread }) => {
      await thread.post(
        Input({
          onSubmit: (ctx) => {
            received.push(ctx.action.value);
            echoedInValues.push(ctx.values[ctx.action.id]);
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
          action_id: textInputs(blocks)[0]!.action_id,
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
    // The same text arrives a second way — via the submitting input's own
    // `state.values` entry — and must not be coerced on that path either.
    expect(echoedInValues).toEqual(typedInputs);
  });

  it("renders an <Input> nested in <Actions> and delivers its text — and a <Select>'s choice — to a clicked <Button>", async () => {
    // <Button> must be inside <Actions>, so this is the only JSX shape that can
    // put the two side by side — and it is the shape Slack used to silently
    // drop while Teams rendered it. The <Select> rides along because a click
    // must carry every control's reading, not just the text ones.
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
            Select({
              placeholder: "Team",
              options: [
                { label: "Core", value: "core" },
                { label: "Infra", value: "infra" },
              ],
              onSelect: () => {},
            }),
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
    const select = statefulElements(blocks).find(
      (el) => el.type === "static_select",
    );
    expect(select).toBeDefined();

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
      { [input!.action_id]: "looks good", [select!.action_id]: "infra" },
    )!;
    fake.emitInteraction(evt);
    await tick();

    expect(clickedValue).toEqual({ decision: "yes" });
    expect(seenValues).toEqual({
      [input!.action_id]: "looks good",
      [select!.action_id]: "infra",
    });
  });
});

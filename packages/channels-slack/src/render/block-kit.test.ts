import { Header, Message, Section, renderToIR } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { describe, expect, it } from "vitest";
import { FIELD_BLOCK_PREFIX } from "../interaction.js";
import { renderBlockKit, renderSlackMessage } from "./block-kit.js";

describe("renderBlockKit", () => {
  it("flattens a message into header + section blocks (markdown → mrkdwn)", () => {
    const ir = renderToIR(
      Message({
        children: [
          Header({ children: "Hi" }),
          Section({ children: "**bold**" }),
        ],
      }),
    );
    expect(renderBlockKit(ir)).toEqual([
      { type: "header", text: { type: "plain_text", text: "Hi" } },
      { type: "section", text: { type: "mrkdwn", text: "*bold*" } },
    ]);
  });

  it("renders a pre-bound button inside actions with its stamped action_id", () => {
    const ir: ChannelNode[] = [
      {
        type: "actions",
        props: {
          children: [
            {
              type: "button",
              props: {
                onClick: { id: "ck:abc" },
                value: { confirmed: true },
                style: "primary",
                children: [{ type: "text", props: { value: "Create" } }],
              },
            },
          ],
        },
      },
    ];
    expect(renderBlockKit(ir)).toEqual([
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: "ck:abc",
            text: { type: "plain_text", text: "Create" },
            value: '{"confirmed":true}',
            style: "primary",
          },
        ],
      },
    ]);
  });

  it("renders a divider", () => {
    expect(renderBlockKit([{ type: "divider", props: {} }])).toEqual([
      { type: "divider" },
    ]);
  });

  it("applies the section text budget (≤3000, trailing ellipsis)", () => {
    const blocks = renderBlockKit(
      renderToIR(Section({ children: "x".repeat(4000) })),
    );
    const section = blocks[0] as { text: { text: string } };
    expect(section.text.text.length).toBeLessThanOrEqual(3000);
    expect(section.text.text.endsWith("…")).toBe(true);
  });

  it("renders an input block with its stamped action_id", () => {
    expect(
      renderBlockKit([
        {
          type: "input",
          props: {
            onSubmit: { id: "ck:in1" },
            placeholder: "Name",
            multiline: false,
          },
        },
      ]),
    ).toEqual([
      {
        type: "input",
        // Unnamed, so the field id `values` keys by is the minted id itself.
        block_id: "ckf:ck:in1",
        dispatch_action: true,
        element: {
          type: "plain_text_input",
          action_id: "ck:in1",
          multiline: false,
          // Enter-to-submit, named rather than left to Slack's default: a
          // `plain_text_input`'s dispatch is "determined by the
          // dispatch_action_config field" (Slack's block_actions reference).
          dispatch_action_config: { trigger_actions_on: ["on_enter_pressed"] },
        },
        label: { type: "plain_text", text: "Name" },
      },
    ]);
  });

  it("renders a bound <Input multiline onSubmit> single-line, so Enter can submit it", () => {
    // Slack cannot express both at once. In a multiline box Enter inserts a
    // newline, so `on_enter_pressed` never fires; the only other trigger,
    // `on_character_entered`, fires once per KEYSTROKE and would run
    // `onSubmit` — a `ClickHandler<string>` promised "the submitted text" —
    // on every prefix of it, resolving a `thread.awaitChoice` on the first
    // character. A one-line box that submits the whole string beats a taller
    // one that submits nothing or a fragment.
    const blocks = renderBlockKit([
      {
        type: "input",
        props: {
          onSubmit: { id: "ck:note" },
          placeholder: "Why?",
          multiline: true,
        },
      },
    ]);

    expect(blocks).toEqual([
      {
        type: "input",
        block_id: "ckf:ck:note",
        dispatch_action: true,
        element: {
          type: "plain_text_input",
          action_id: "ck:note",
          multiline: false,
          dispatch_action_config: { trigger_actions_on: ["on_enter_pressed"] },
        },
        label: { type: "plain_text", text: "Why?" },
      },
    ]);
  });

  it("keeps the tall box for an <Input multiline> with no onSubmit, and dispatches nothing for it", () => {
    // Nothing to make unreachable: the text rides to a sibling `<Button>`'s
    // click in `state.values`, which needs no trigger on this element. Naming
    // one anyway would be the same unfireable configuration the bound case
    // avoids — `on_enter_pressed` cannot fire in a multiline box.
    const blocks = renderBlockKit([
      {
        type: "input",
        props: { name: "reason", placeholder: "Why?", multiline: true },
      },
    ]);

    expect(blocks).toEqual([
      {
        type: "input",
        block_id: "ckf:reason",
        dispatch_action: false,
        element: {
          type: "plain_text_input",
          action_id: "reason",
          multiline: true,
        },
        label: { type: "plain_text", text: "Why?" },
      },
    ]);
  });

  it("does not let a decorative <Input> beside a <Button> claim a dispatch trigger", () => {
    // The engine resolves a pending `thread.awaitChoice` on ANY interaction in
    // the conversation, so an unbound notes box that dispatched would answer
    // the Approve/Reject choice with whatever the user typed — the button
    // handler never running. Only the button may dispatch here.
    const blocks = renderBlockKit([
      { type: "input", props: { name: "notes", placeholder: "Notes" } },
      {
        type: "actions",
        props: {
          children: [
            {
              type: "button",
              props: {
                onClick: { id: "ck:approve" },
                children: [{ type: "text", props: { value: "Approve" } }],
              },
            },
          ],
        },
      },
    ]);

    const input = blocks[0] as { type: string; dispatch_action: boolean };
    expect(input.type).toBe("input");
    expect(input.dispatch_action).toBe(false);
    // …and the notes text still reaches the button's handler, because Slack
    // reports every input in `state.values` regardless of `dispatch_action`.
    expect(blocks[1]).toMatchObject({
      type: "actions",
      elements: [{ action_id: "ck:approve" }],
    });
  });

  it("does not let an unbound <Select multi> claim a dispatch trigger", () => {
    const blocks = renderBlockKit([
      {
        type: "actions",
        props: {
          children: [
            {
              type: "select",
              props: { multi: true, options: [{ label: "Core", value: "c" }] },
            },
          ],
        },
      },
    ]);

    expect(blocks[0]).toMatchObject({ type: "input", dispatch_action: false });
  });

  it("gives a static_select a unique fallback action_id when onSelect is absent", () => {
    const blocks = renderBlockKit([
      {
        type: "actions",
        props: {
          children: [
            {
              type: "select",
              props: { options: [{ label: "A", value: "a" }] },
            },
          ],
        },
      },
    ]);
    const select = (blocks[0] as { elements: { action_id: string }[] })
      .elements[0]!;
    // The field id, not the bare `"select"` literal a second one would repeat.
    expect(select.action_id).toBe("select_1");
  });

  it("writes select option values verbatim, never JSON-encoded", () => {
    // The wire codec the decoder is paired with: a `SelectOption.value` is a
    // `string` and goes out as-is, so `interaction.ts` must NOT JSON-parse it
    // back. (A `<Button>`'s value is the opposite — see the JSON.stringify
    // case above.) Values that happen to look like JSON make the difference
    // visible.
    const options = [
      { label: "A", value: "42" },
      { label: "B", value: "true" },
      { label: "C", value: "null" },
    ];
    for (const multi of [false, true]) {
      const blocks = renderBlockKit([
        {
          type: "actions",
          props: { children: [{ type: "select", props: { options, multi } }] },
        },
      ]);
      const el = multi
        ? (blocks[0] as { element: { options: { value: string }[] } }).element
        : (blocks[0] as { elements: { options: { value: string }[] }[] })
            .elements[0]!;
      expect(el.options.map((o) => o.value)).toEqual(["42", "true", "null"]);
    }
  });

  it("renders a Table IR into a native Slack table block", () => {
    const ir: ChannelNode[] = [
      {
        type: "table",
        props: {
          columns: [{ header: "Name" }, { header: "Status", align: "center" }],
          children: [
            {
              type: "row",
              props: {
                children: [
                  {
                    type: "cell",
                    props: {
                      children: [{ type: "text", props: { value: "Ana" } }],
                    },
                  },
                  {
                    type: "cell",
                    props: {
                      children: [{ type: "text", props: { value: "Active" } }],
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    ];
    expect(renderBlockKit(ir)).toEqual([
      {
        type: "table",
        rows: [
          [
            { type: "raw_text", text: "Name" },
            { type: "raw_text", text: "Status" },
          ],
          [
            { type: "raw_text", text: "Ana" },
            { type: "raw_text", text: "Active" },
          ],
        ],
        column_settings: [{ align: "left" }, { align: "center" }],
      },
    ]);
  });

  it("passes raw native Block Kit through unchanged", () => {
    expect(
      renderBlockKit([
        {
          type: "raw",
          props: {
            value: [
              { type: "section", text: { type: "mrkdwn", text: "native" } },
            ],
          },
        },
      ]),
    ).toEqual([{ type: "section", text: { type: "mrkdwn", text: "native" } }]);
  });

  it("renders a link button with a url", () => {
    const blocks = renderBlockKit([
      {
        type: "actions",
        props: {
          children: [
            {
              type: "button",
              props: {
                url: "https://dash/deploy/42",
                children: [{ type: "text", props: { value: "Open" } }],
              },
            },
          ],
        },
      },
    ]);
    const el = (blocks[0] as { elements: { url?: string }[] }).elements[0]!;
    expect(el.url).toBe("https://dash/deploy/42");
  });

  it("renders a Field label as a bold mrkdwn line above the value", () => {
    const blocks = renderBlockKit([
      {
        type: "field",
        props: {
          label: "Status",
          children: [{ type: "text", props: { value: "Online" } }],
        },
      },
    ]);
    const text = (blocks[0] as { fields: { text: string }[] }).fields[0]!.text;
    expect(text).toBe("*Status*\nOnline");
  });

  it("renders a multi-select as its own input block, not inside actions", () => {
    const blocks = renderBlockKit([
      {
        type: "actions",
        props: {
          children: [
            {
              type: "select",
              props: {
                multi: true,
                onSelect: { id: "ck:ms" },
                placeholder: "Pick teams",
                options: [
                  { label: "Core", value: "core" },
                  { label: "Infra", value: "infra" },
                ],
              },
            },
          ],
        },
      },
    ]);
    // No actions block is emitted (the only child was peeled into an input block).
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as {
      type: string;
      dispatch_action: boolean;
      element: { type: string; action_id: string };
    };
    expect(block.type).toBe("input");
    expect(block.dispatch_action).toBe(true);
    expect(block.element.type).toBe("multi_static_select");
    expect(block.element.action_id).toBe("ck:ms");
    // `dispatch_action` alone IS reachable here, unlike on a multiline
    // `plain_text_input`: Slack dispatches a `multi_*_select` "each time an
    // item is chosen from the multi-select menu" (block_actions reference),
    // with no trigger to configure. `dispatch_action_config` is documented as
    // usable only with a plain-text or rich-text input, so adding one here
    // would be an unsupported field, not a fix.
    expect(block.element).not.toHaveProperty("dispatch_action_config");
  });

  it("renders an <Input> nested in <Actions> instead of dropping it", () => {
    // Slack forbids plain_text_input inside an actions block while requiring
    // <Button> to be in one; Teams' actions case just recurses. Peeling the
    // input out keeps identical JSX from diverging between the two surfaces.
    const blocks = renderBlockKit([
      {
        type: "actions",
        props: {
          children: [
            {
              type: "input",
              props: { onSubmit: { id: "ck:note" }, placeholder: "Why?" },
            },
          ],
        },
      },
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "input",
      dispatch_action: true,
      element: { type: "plain_text_input", action_id: "ck:note" },
    });
  });

  it("keeps source order when an <Input> is mixed with a button", () => {
    const blocks = renderBlockKit([
      {
        type: "actions",
        props: {
          children: [
            {
              type: "input",
              props: { onSubmit: { id: "ck:note" } },
            },
            {
              type: "button",
              props: {
                onClick: { id: "ck:b" },
                children: [{ type: "text", props: { value: "Go" } }],
              },
            },
          ],
        },
      },
    ]);

    expect(blocks.map((b) => (b as { type: string }).type)).toEqual([
      "input",
      "actions",
    ]);
  });

  it("keeps source order when a multi-select is mixed with a button", () => {
    const blocks = renderBlockKit([
      {
        type: "actions",
        props: {
          children: [
            {
              type: "button",
              props: {
                onClick: { id: "ck:b" },
                children: [{ type: "text", props: { value: "Go" } }],
              },
            },
            {
              type: "select",
              props: {
                multi: true,
                onSelect: { id: "ck:ms" },
                options: [{ label: "Core", value: "core" }],
              },
            },
          ],
        },
      },
    ]);
    // The button's actions block comes first, then the multi-select input block.
    expect(blocks.map((b) => (b as { type: string }).type)).toEqual([
      "actions",
      "input",
    ]);
  });

  it("does not charge peeled-off inputs against the actions element budget", () => {
    // The peeled <Input> and <Select multi> land in their own input blocks, so
    // they occupy no slot in the actions block and must not cost it any.
    const blocks = renderBlockKit([
      {
        type: "actions",
        props: {
          children: [
            { type: "input", props: { onSubmit: { id: "ck:note" } } },
            {
              type: "select",
              props: {
                multi: true,
                onSelect: { id: "ck:ms" },
                options: [{ label: "Core", value: "core" }],
              },
            },
            ...buttons(25),
          ],
        },
      },
    ]);

    expect(blocks.map((b) => (b as { type: string }).type)).toEqual([
      "input",
      "input",
      "actions",
    ]);
    expect((blocks[2] as { elements: unknown[] }).elements).toHaveLength(25);
  });

  it("budgets actions elements per emitted block, not per child list", () => {
    // A peeled input splits the children across two actions blocks; each block
    // is under the 25-element ceiling on its own, so nothing may be dropped.
    const blocks = renderBlockKit([
      {
        type: "actions",
        props: {
          children: [
            ...buttons(20, "a"),
            { type: "input", props: { onSubmit: { id: "ck:note" } } },
            ...buttons(20, "b"),
          ],
        },
      },
    ]);

    expect(blocks.map((b) => (b as { type: string }).type)).toEqual([
      "actions",
      "input",
      "actions",
    ]);
    expect((blocks[0] as { elements: unknown[] }).elements).toHaveLength(20);
    expect((blocks[2] as { elements: unknown[] }).elements).toHaveLength(20);
  });

  it("still clamps an actions block that really overflows the element limit", () => {
    const blocks = renderBlockKit([
      { type: "actions", props: { children: buttons(30) } },
    ]);

    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { elements: unknown[] }).elements).toHaveLength(25);
  });

  it("counts the table header against the table row budget", () => {
    // The header is a row of the emitted block, so 100 data rows + a header
    // would put the table one row over Slack's ceiling.
    const blocks = renderBlockKit([
      {
        type: "table",
        props: {
          columns: [{ header: "Name" }],
          children: Array.from({ length: 100 }, (_, i) => ({
            type: "row",
            props: {
              children: [
                {
                  type: "cell",
                  props: {
                    children: [{ type: "text", props: { value: `r${i}` } }],
                  },
                },
              ],
            },
          })),
        },
      },
    ]);

    const rows = (blocks[0] as { rows: { text: string }[][] }).rows;
    expect(rows).toHaveLength(100);
    expect(rows[0]![0]!.text).toBe("Name");
  });
});

/**
 * The `values` key a field's reading arrives under, and how it gets onto the
 * wire. Teams derives an Adaptive Card element's `id` — which becomes the
 * `values` key there — as `name ?? mintedActionId ?? \`${kind}_${index}\``,
 * deduped (see `fieldId()` in channels-teams' `render/adaptive-card.ts`). Slack
 * must land on the same key for the same JSX, so it carries the field id in the
 * block id and leaves `action_id` to dispatch.
 */
describe("field ids (Slack ↔ Teams `values` key parity)", () => {
  /** The `ckf:`-stripped field id of each block that names one, in block order. */
  function fieldIds(blocks: unknown[]): string[] {
    return blocks
      .map((b) => (b as { block_id?: string }).block_id)
      .filter((id): id is string => id?.startsWith(FIELD_BLOCK_PREFIX) === true)
      .map((id) => id.slice(FIELD_BLOCK_PREFIX.length));
  }

  it("keys a named <Input> by its `name`, while `action_id` stays the minted id", () => {
    // Teams honours `name`; Slack ignored it, so `ctx.values.reason` resolved on
    // one surface and was `undefined` on the other. `action_id` may not change
    // with it: the engine dispatches on exactly that string.
    const blocks = renderBlockKit([
      {
        type: "input",
        props: {
          name: "reason",
          onSubmit: { id: "ck:in1" },
          placeholder: "Why?",
        },
      },
    ]);
    expect(blocks[0]).toMatchObject({
      type: "input",
      block_id: "ckf:reason",
      element: { type: "plain_text_input", action_id: "ck:in1" },
    });
  });

  it("keys a named <Select> (single and multi) by its `name`", () => {
    for (const multi of [false, true]) {
      const blocks = renderBlockKit([
        {
          type: "actions",
          props: {
            children: [
              {
                type: "select",
                props: {
                  multi,
                  name: "team",
                  onSelect: { id: "ck:sel" },
                  options: [{ label: "Core", value: "core" }],
                },
              },
            ],
          },
        },
      ]);
      expect(fieldIds(blocks)).toEqual(["team"]);
      // Dispatch is unmoved: the minted id still rides on the element.
      const el = blocks[0] as {
        element?: { action_id: string };
        elements?: { action_id: string }[];
      };
      expect((el.element ?? el.elements![0]!).action_id).toBe("ck:sel");
    }
  });

  it("gives two handler-less <Input>s distinct field ids", () => {
    // Both used to be keyed `input`, so `flattenBlockState` overwrote one with
    // the other and a field's submitted text was silently lost.
    const blocks = renderBlockKit([
      { type: "input", props: { placeholder: "First" } },
      { type: "input", props: { placeholder: "Second" } },
    ]);
    expect(fieldIds(blocks)).toEqual(["input_1", "input_2"]);
  });

  it("numbers unnamed fields off one counter shared by inputs and selects", () => {
    // The exact ids Teams' `fieldId()` mints for this JSX: an explicit `name`
    // first, then the minted handler id, then `${kind}_${index}` off a counter
    // that every field advances.
    const blocks = renderBlockKit([
      {
        type: "actions",
        props: {
          children: [
            { type: "input", props: { name: "reason" } },
            { type: "input", props: { onSubmit: { id: "ck:in2" } } },
            { type: "input", props: {} },
            {
              type: "select",
              props: { options: [{ label: "A", value: "a" }] },
            },
          ],
        },
      },
    ]);
    expect(fieldIds(blocks)).toEqual([
      "reason",
      "ck:in2",
      "input_3",
      "select_4",
    ]);
  });

  it("dedupes two fields that claim the same `name`", () => {
    const blocks = renderBlockKit([
      { type: "input", props: { name: "reason" } },
      { type: "input", props: { name: "reason" } },
    ]);
    expect(fieldIds(blocks)).toEqual(["reason", "reason_1"]);
  });
});

/**
 * Pins the Slack↔Teams gaps that peeling fields out of `<Actions>` did NOT
 * close, so the follow-up that closes them has to flip an assertion rather than
 * discover the divergence. Teams renders every node below outside an
 * `<Actions>` (`Input.ChoiceSet`, an `Action.Submit`, and `Chart.Line`
 * respectively); Slack's `renderNode` has no case for any of them.
 */
describe("Slack↔Teams render gaps (documented, not yet closed)", () => {
  const select: ChannelNode = {
    type: "select",
    props: {
      onSelect: { id: "ck:sel" },
      options: [{ label: "A", value: "a" }],
    },
  };
  const button: ChannelNode = {
    type: "button",
    props: {
      onClick: { id: "ck:btn" },
      children: [{ type: "text", props: { value: "Go" } }],
    },
  };
  const chart: ChannelNode = {
    type: "chart",
    props: { type: "line", data: [{ label: "x", value: 1 }] },
  };

  it.each([
    ["select", select],
    ["button", button],
    ["chart", chart],
  ])("drops a top-level <%s> outside <Actions>", (_name, node) => {
    expect(renderBlockKit([node])).toEqual([]);
  });

  it("drops all three together, emitting no blocks at all", () => {
    expect(renderBlockKit([select, button, chart])).toEqual([]);
  });

  it("renders <Select> and <Button> inside <Actions>, but still drops <Chart>", () => {
    const blocks = renderBlockKit([
      { type: "actions", props: { children: [select, button, chart] } },
    ]);
    // The select is peeled into its own block; the button keeps an `actions`
    // block. Nothing in between is the chart — it has no Slack rendering at
    // any depth.
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      type: "actions",
      block_id: `${FIELD_BLOCK_PREFIX}ck:sel`,
      elements: [{ type: "static_select" }],
    });
    expect(blocks[1]).toMatchObject({
      type: "actions",
      elements: [{ type: "button", action_id: "ck:btn" }],
    });
  });
});

/** `count` pre-bound `<Button>` IR nodes with distinct ids. */
function buttons(count: number, prefix = "b"): ChannelNode[] {
  return Array.from({ length: count }, (_, i) => ({
    type: "button",
    props: {
      onClick: { id: `ck:${prefix}${i}` },
      children: [{ type: "text", props: { value: `B${i}` } }],
    },
  }));
}

describe("renderSlackMessage", () => {
  it("extracts a top-level <Message accent> as the attachment color", () => {
    expect(
      renderSlackMessage([
        {
          type: "message",
          props: {
            accent: "#EB5757",
            children: [
              {
                type: "section",
                props: { children: [{ type: "text", props: { value: "hi" } }] },
              },
            ],
          },
        },
      ]),
    ).toEqual({
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "hi" } }],
      accent: "#EB5757",
    });
  });

  it("returns no accent when there is no message wrapper", () => {
    expect(
      renderSlackMessage([
        {
          type: "section",
          props: { children: [{ type: "text", props: { value: "hi" } }] },
        },
      ]),
    ).toEqual({
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "hi" } }],
      accent: undefined,
    });
  });
});

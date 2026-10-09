import {
  Actions,
  Header,
  Input,
  Message,
  Section,
  Select,
  renderToIR,
} from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { describe, expect, it } from "vitest";
import { decodeInteraction } from "../interaction.js";
import { renderBlockKit, renderSlackMessage } from "./block-kit.js";

const ISSUE_URL = "https://linear.app/copilotkit/issue/CPK-1234";

/** One-row table IR with the given header + cell texts. */
const table = (headers: string[], cells: string[]): ChannelNode[] => [
  {
    type: "table",
    props: {
      columns: headers.map((header) => ({ header })),
      children: [
        {
          type: "row",
          props: {
            children: cells.map((value) => ({
              type: "cell",
              props: { children: [{ type: "text", props: { value } }] },
            })),
          },
        },
      ],
    },
  },
];

/** The rendered `rows` of the single table block produced by `ir`. */
const cellsOf = (ir: ChannelNode[]): unknown[][] =>
  (renderBlockKit(ir)[0] as unknown as { rows: unknown[][] }).rows;

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
        // No `name` given, so the block id falls back to the minted handler id.
        block_id: "ck:in1",
        dispatch_action: true,
        element: {
          type: "plain_text_input",
          action_id: "ck:in1",
          multiline: false,
        },
        label: { type: "plain_text", text: "Name" },
      },
    ]);
  });

  it("gives a static_select a fallback action_id when onSelect is absent", () => {
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
    expect(select.action_id).toBe("select");
    expect(select.action_id.length).toBeGreaterThan(0);
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

  describe("table cells", () => {
    it("keeps plain content as raw_text, byte for byte", () => {
      const [, body] = cellsOf(table(["Status"], ["🟡 In Progress"]));
      expect(body).toEqual([{ type: "raw_text", text: "🟡 In Progress" }]);
    });

    it("promotes a markdown link with bold label to a rich_text cell", () => {
      const [, body] = cellsOf(
        table(["Issue"], [`[**CPK-1234**](${ISSUE_URL})`]),
      );
      expect(body).toEqual([
        {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_section",
              elements: [
                {
                  type: "link",
                  url: ISSUE_URL,
                  text: "CPK-1234",
                  style: { bold: true },
                },
              ],
            },
          ],
        },
      ]);
    });

    it("renders mixed runs in one cell", () => {
      const [, body] = cellsOf(
        table(
          ["Mixed"],
          [`**bold** plain \`code\` — [unstyled link](${ISSUE_URL})`],
        ),
      );
      expect(body).toEqual([
        {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_section",
              elements: [
                { type: "text", text: "bold", style: { bold: true } },
                { type: "text", text: " plain " },
                { type: "text", text: "code", style: { code: true } },
                { type: "text", text: " — " },
                { type: "link", url: ISSUE_URL, text: "unstyled link" },
              ],
            },
          ],
        },
      ]);
    });

    it("never promotes a header cell, even with markdown in it", () => {
      const [header] = cellsOf(table([`[**Issue**](${ISSUE_URL})`], ["plain"]));
      expect(header).toEqual([
        { type: "raw_text", text: `[**Issue**](${ISSUE_URL})` },
      ]);
    });

    it("truncates a plain cell at 2000 chars", () => {
      const [, body] = cellsOf(table(["Long"], ["a".repeat(2500)]));
      expect(body).toEqual([
        { type: "raw_text", text: "a".repeat(1999) + "…" },
      ]);
    });

    it("truncates a rich cell on visible text, keeping the styling", () => {
      const [, body] = cellsOf(table(["Long"], [`**${"a".repeat(2500)}**`]));
      expect(body).toEqual([
        {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_section",
              elements: [
                {
                  type: "text",
                  text: "a".repeat(1999) + "…",
                  style: { bold: true },
                },
              ],
            },
          ],
        },
      ]);
    });
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
});

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

/**
 * OSS-848: the `ctx.values` key a handler reads is the rendered BLOCK id, so it
 * has to come from the author's `name` — Teams already keys its fields that way
 * (`channels-teams/src/render/adaptive-card.ts`), and without it Slack hands the
 * handler a fresh random key per render.
 *
 * These go through the renderer on purpose. Tests that hand-write a payload
 * cannot catch this: they invent block ids that are already meaningful names,
 * which is a shape only a hand-authored native block produces.
 */
/**
 * Rebuild the `state.values` Slack would send for these blocks: `blockId →
 * actionId → element`. A block the renderer left unnamed gets the random id
 * Slack would mint, which is exactly the failure mode under test.
 */
const stateValuesFor = (
  blocks: unknown[],
  report: Record<string, unknown>,
): Record<string, Record<string, unknown>> => {
  const out: Record<string, Record<string, unknown>> = {};
  let random = 0;
  for (const raw of blocks) {
    const block = raw as {
      type: string;
      block_id?: string;
      element?: { action_id?: string; type?: string };
      elements?: { action_id?: string; type?: string }[];
    };
    const elements =
      block.type === "input" && block.element
        ? [block.element]
        : block.type === "actions"
          ? (block.elements ?? [])
          : [];
    const stateful = elements.filter((el) => el.type !== "button");
    if (stateful.length === 0) continue;
    const blockId = block.block_id ?? `slack-random-${++random}`;
    out[blockId] = {};
    for (const el of stateful) {
      out[blockId]![el.action_id ?? "?"] = { type: el.type, ...report };
    }
  }
  return out;
};

describe("author-named fields survive into the rendered block (OSS-848)", () => {
  /** The blocks' `block_id`s, in render order. */
  const blockIds = (ir: ChannelNode[]): (string | undefined)[] =>
    renderBlockKit(ir).map((b) => (b as { block_id?: string }).block_id);

  it("keys an <Input name> block by the author's name", () => {
    expect(
      blockIds(renderToIR(Input({ name: "root_cause", placeholder: "Why?" }))),
    ).toEqual(["root_cause"]);
  });

  it("keys a <Select multi name> block by the author's name", () => {
    expect(
      blockIds(
        renderToIR(
          Actions({
            children: Select({
              name: "services",
              multi: true,
              options: [{ label: "Payments", value: "pay" }],
            }),
          }),
        ),
      ),
    ).toEqual(["services"]);
  });

  it("gives a named <Select> in <Actions> a block of its own so its name is representable", () => {
    // A block carries ONE block_id, so a named select cannot share one.
    const ir = renderToIR(
      Actions({
        children: [
          Select({
            name: "severity",
            options: [{ label: "High", value: "h" }],
          }),
          Select({ options: [{ label: "A", value: "a" }] }),
        ],
      }),
    );
    expect(blockIds(ir)).toEqual(["severity", undefined]);
  });

  it("falls back to the minted handler id, then to a positional id", () => {
    // `onSubmit` is pre-bound by the action registry to a `{ id }` stamp.
    const ir: ChannelNode[] = [
      { type: "input", props: { onSubmit: { id: "ck:h1" } } },
      { type: "input", props: { placeholder: "unnamed" } },
    ];
    expect(blockIds(ir)).toEqual(["ck:h1", "input_2"]);
  });

  it("de-duplicates a repeated name, because Slack rejects a duplicate block_id", () => {
    const ir = renderToIR(
      Message({
        children: [Input({ name: "note" }), Input({ name: "note" })],
      }),
    );
    expect(blockIds(ir)).toEqual(["note", "note_1"]);
  });

  it("round-trips <Input name> through render → Slack state.values → ctx.values", () => {
    const blocks = renderBlockKit(
      renderToIR(
        Message({
          children: [
            Input({ name: "root_cause", placeholder: "Why?" }),
            Actions({
              children: Select({
                name: "severity",
                options: [{ label: "High", value: "high" }],
              }),
            }),
          ],
        }),
      ),
    );
    const evt = decodeInteraction({
      type: "block_actions",
      channel: { id: "C1" },
      message: { ts: "1.0" },
      actions: [{ action_id: "ck:submit", value: "go" }],
      state: { values: stateValuesFor(blocks, { value: "pool exhausted" }) },
    });
    // The author's own names, not Slack's random ids.
    expect(Object.keys(evt!.values!).sort()).toEqual([
      "root_cause",
      "severity",
    ]);
  });
});

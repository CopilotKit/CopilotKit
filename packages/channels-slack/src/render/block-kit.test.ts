import { Header, Message, Section, renderToIR } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { describe, expect, it } from "vitest";
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

import { Header, Message, Section, renderToIR } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { describe, expect, it } from "vitest";
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

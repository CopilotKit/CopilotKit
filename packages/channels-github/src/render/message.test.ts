import {
  Actions,
  Button,
  Cell,
  Context,
  Divider,
  Field,
  Fields,
  Header,
  Image,
  Markdown,
  Message,
  Row,
  Section,
  Select,
  Table,
  renderToIR,
} from "@copilotkit/channels-ui";
import type { ChannelNode, SelectOption } from "@copilotkit/channels-ui";
import { describe, expect, it } from "vitest";
import { GITHUB_LIMITS } from "./budget.js";
import { VALUE_ONLY_CHOICE_ID, renderGitHubMessage } from "./message.js";

/** A button as the action registry leaves it: `onClick` rewritten to `{ id }`. */
function stampedButton(
  label: string,
  id: string,
  value?: unknown,
): ChannelNode {
  return {
    type: "button",
    props: {
      children: [{ type: "text", props: { value: label } }],
      onClick: { id },
      value,
    },
  };
}

/** A select as the action registry leaves it: `onSelect` rewritten to `{ id }`. */
function stampedSelect(id: string, options: SelectOption[]): ChannelNode {
  return { type: "select", props: { onSelect: { id }, options } };
}

function render(ui: ChannelNode) {
  return renderGitHubMessage(renderToIR(ui));
}

describe("renderGitHubMessage", () => {
  it("keeps adjacent text in one paragraph and returns no choices", () => {
    const out = render(
      Message({
        children: ["Hello ", "**Ada**", Section({ children: "Second block" })],
      }),
    );
    expect(out).toEqual({ body: "Hello **Ada**\n\nSecond block", choices: [] });
  });

  it("maps header, markdown, fields, table, divider, context and image to GFM", () => {
    const out = render(
      Message({
        children: [
          Header({ children: "Build report" }),
          Markdown({ children: "Use `pnpm test`." }),
          Fields({
            children: [
              Field({ label: "Status", children: "green" }),
              Field({ children: "no label" }),
            ],
          }),
          Table({
            columns: [{ header: "Job" }, { header: "Time", align: "right" }],
            children: [
              Row({
                children: [
                  Cell({ children: "lint | types" }),
                  Cell({ children: "12s" }),
                ],
              }),
              Row({ children: [Cell({ children: "test\nunit" })] }),
            ],
          }),
          Divider({}),
          Context({ children: "Run #42\nmain" }),
          Image({ url: "https://example.com/a.png", alt: "chart [v2]" }),
        ],
      }),
    );
    expect(out.body).toBe(
      [
        "### Build report",
        "Use `pnpm test`.",
        "- **Status:** green\n- no label",
        "| Job | Time |\n| --- | ---: |\n| lint \\| types | 12s |\n| test<br>unit |  |",
        "---",
        "<sub>Run #42 main</sub>",
        "![chart \\[v2\\]](https://example.com/a.png)",
      ].join("\n\n"),
    );
    expect(out.choices).toEqual([]);
  });

  it("renders handler buttons as a numbered list with their action ids", () => {
    const out = render(
      Message({
        children: [
          Section({ children: "Deploy?" }),
          Actions({
            children: [
              stampedButton("Ship it", "ck:ship", "ship"),
              stampedButton("Wait", "ck:wait"),
            ],
          }),
        ],
      }),
    );
    expect(out.body).toBe(
      "Deploy?\n\nReply with a number:\n\n1. Ship it\n2. Wait",
    );
    expect(out.choices).toEqual([
      { index: 1, label: "Ship it", actionId: "ck:ship", value: "ship" },
      { index: 2, label: "Wait", actionId: "ck:wait", value: undefined },
    ]);
  });

  it("gives value-only buttons the synthetic id so their values round-trip", () => {
    const out = render(
      Actions({
        children: [
          Button({ value: { approved: true }, children: "Approve" }),
          Button({ value: { approved: false }, children: "Reject" }),
          Button({ children: "Does nothing" }),
        ],
      }),
    );
    expect(out.body).toBe("Reply with a number:\n\n1. Approve\n2. Reject");
    expect(out.choices).toEqual([
      {
        index: 1,
        label: "Approve",
        actionId: VALUE_ONLY_CHOICE_ID,
        value: { approved: true },
      },
      {
        index: 2,
        label: "Reject",
        actionId: VALUE_ONLY_CHOICE_ID,
        value: { approved: false },
      },
    ]);
  });

  it("numbers select options after buttons, using the select's id and option values", () => {
    const out = render(
      Actions({
        children: [
          stampedButton("Cancel", "ck:cancel"),
          stampedSelect("ck:region", [
            { label: "Europe", value: "eu" },
            { label: "United States", value: "us" },
          ]),
        ],
      }),
    );
    expect(out.choices).toEqual([
      { index: 1, label: "Cancel", actionId: "ck:cancel", value: undefined },
      { index: 2, label: "Europe", actionId: "ck:region", value: "eu" },
      { index: 3, label: "United States", actionId: "ck:region", value: "us" },
    ]);
    expect(out.body).toBe(
      "Reply with a number:\n\n1. Cancel\n2. Europe\n3. United States",
    );
  });

  it("renders a link button as a Markdown link, not a choice", () => {
    const out = render(
      Actions({
        children: Button({ url: "https://example.com", children: "Docs" }),
      }),
    );
    expect(out).toEqual({ body: "[Docs](https://example.com)", choices: [] });
  });

  it("truncates the prose and keeps the whole choice list when the body is too long", () => {
    const out = render(
      Message({
        children: [
          Section({ children: "x".repeat(GITHUB_LIMITS.commentBody) }),
          Actions({
            children: [
              stampedButton("Yes", "ck:yes"),
              stampedButton("No", "ck:no"),
            ],
          }),
        ],
      }),
    );
    expect(out.body).toHaveLength(GITHUB_LIMITS.commentBody);
    expect(
      out.body.endsWith(
        "… _(truncated)_\n\nReply with a number:\n\n1. Yes\n2. No",
      ),
    ).toBe(true);
    expect(out.choices).toHaveLength(2);
  });
});

import { expect, test } from "vitest";
import { createNativeNode } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import * as slackRender from "./render/block-kit.js";
import * as slack from "./index.js";

function sections(count: number): ChannelNode[] {
  return Array.from({ length: count }, (_, index) => ({
    type: "section",
    props: { children: `Section ${index}` },
  }));
}

test("exports a strict renderer for Channel component revisions", () => {
  expect(slackRender).toHaveProperty(
    "renderSlackComponentMessage",
    expect.any(Function),
  );
});

test("exports the Slack component edit cadence", () => {
  expect(slack.SLACK_COMPONENT_EDIT_INTERVAL_MS).toBe(800);
});

test("component rendering rejects portable blocks that normal rendering clamps", () => {
  const ir = sections(51);

  const normal = slackRender.renderSlackMessage(ir);

  expect(normal.blocks).toHaveLength(50);
  expect(() => slackRender.renderSlackComponentMessage(ir)).toThrow(
    "Slack Channel component rendered 51 blocks; the message limit is 50.",
  );
});

test("component rendering rejects Teams native JSX before Slack delivery", () => {
  const teamsCard = createNativeNode("teams", "root", "AdaptiveCard", {});

  expect(() => slackRender.renderSlackComponentMessage([teamsCard])).toThrow(
    "Slack delivery cannot render Teams native JSX.",
  );
});

test("component rendering rejects text that normal rendering truncates", () => {
  const ir = sections(1);
  ir[0]!.props.children = {
    type: "text",
    props: { value: "x".repeat(3_001) },
  };

  const normal = slackRender.renderSlackMessage(ir);

  expect(
    (normal.blocks[0] as { text: { text: string } }).text.text,
  ).toHaveLength(3_000);
  expect(() => slackRender.renderSlackComponentMessage(ir)).toThrow(
    "Slack Channel component section text has 3001 characters; the limit is 3000.",
  );
});

test("component rendering rejects oversized native text", () => {
  const raw = createNativeNode("slack", "raw", "Raw", {
    value: {
      type: "section",
      text: { type: "mrkdwn", text: "x".repeat(3_001) },
    },
  });

  expect(slackRender.renderSlackMessage([raw]).blocks).toHaveLength(1);
  expect(() => slackRender.renderSlackComponentMessage([raw])).toThrow(
    "Slack Channel component section text has 3001 characters; the limit is 3000.",
  );
});

test.each([
  [
    "field text",
    [
      {
        type: "field",
        props: {
          children: { type: "text", props: { value: "x".repeat(2_001) } },
        },
      },
    ],
    "field text has 2001 characters; the limit is 2000",
  ],
  [
    "table cell text",
    [
      {
        type: "table",
        props: {
          children: {
            type: "row",
            props: {
              children: {
                type: "cell",
                props: {
                  children: {
                    type: "text",
                    props: { value: "x".repeat(2_001) },
                  },
                },
              },
            },
          },
        },
      },
    ],
    "table cell text has 2001 characters; the limit is 2000",
  ],
  [
    "button text",
    [
      {
        type: "actions",
        props: {
          children: {
            type: "button",
            props: {
              children: { type: "text", props: { value: "x".repeat(76) } },
            },
          },
        },
      },
    ],
    "button text has 76 characters; the limit is 75",
  ],
  [
    "button value",
    [
      {
        type: "actions",
        props: {
          children: {
            type: "button",
            props: {
              children: { type: "text", props: { value: "Go" } },
              value: "x".repeat(2_001),
              onClick: { id: "ck:button" },
            },
          },
        },
      },
    ],
    "button value has 2003 characters; the limit is 2000",
  ],
  [
    "action id",
    [
      {
        type: "actions",
        props: {
          children: {
            type: "button",
            props: {
              children: { type: "text", props: { value: "Go" } },
              onClick: { id: "x".repeat(256) },
            },
          },
        },
      },
    ],
    "action id has 256 characters; the limit is 255",
  ],
  [
    "select placeholder",
    [
      {
        type: "actions",
        props: {
          children: {
            type: "select",
            props: { placeholder: "x".repeat(151), options: [] },
          },
        },
      },
    ],
    "select placeholder has 151 characters; the limit is 150",
  ],
  [
    "select option label",
    [
      {
        type: "actions",
        props: {
          children: {
            type: "select",
            props: {
              options: [{ label: "x".repeat(76), value: "value" }],
            },
          },
        },
      },
    ],
    "select option label has 76 characters; the limit is 75",
  ],
  [
    "select option value",
    [
      {
        type: "actions",
        props: {
          children: {
            type: "select",
            props: {
              options: [{ label: "label", value: "x".repeat(151) }],
            },
          },
        },
      },
    ],
    "select option value has 151 characters; the limit is 150",
  ],
  [
    "input label",
    [{ type: "input", props: { placeholder: "x".repeat(151) } }],
    "input label has 151 characters; the limit is 150",
  ],
] as const)(
  "component rendering rejects oversized %s instead of truncating it",
  (_label, ir, message) => {
    expect(() => renderSlack(ir as unknown as ChannelNode[])).toThrow(message);
  },
);

function renderSlack(ir: ChannelNode[]) {
  return slackRender.renderSlackComponentMessage(ir);
}

test.each([
  [
    "native actions",
    {
      type: "actions",
      elements: Array.from({ length: 26 }, () => ({
        type: "button",
        text: { type: "plain_text", text: "Go" },
        action_id: "go",
      })),
    },
    "action elements has 26 items; the limit is 25",
  ],
  [
    "native field text",
    { type: "section", fields: [{ type: "mrkdwn", text: "x".repeat(2_001) }] },
    "field text has 2001 characters; the limit is 2000",
  ],
  [
    "native button text",
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "x".repeat(76) },
          action_id: "go",
        },
      ],
    },
    "button text has 76 characters; the limit is 75",
  ],
  [
    "native button value",
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Go" },
          action_id: "go",
          value: "x".repeat(2_001),
        },
      ],
    },
    "button value has 2001 characters; the limit is 2000",
  ],
  [
    "native action id",
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Go" },
          action_id: "x".repeat(256),
        },
      ],
    },
    "action id has 256 characters; the limit is 255",
  ],
  [
    "native select placeholder",
    {
      type: "actions",
      elements: [
        {
          type: "static_select",
          action_id: "select",
          placeholder: { type: "plain_text", text: "x".repeat(151) },
          options: [],
        },
      ],
    },
    "select placeholder has 151 characters; the limit is 150",
  ],
  [
    "native select option label",
    {
      type: "actions",
      elements: [
        {
          type: "static_select",
          action_id: "select",
          options: [
            {
              text: { type: "plain_text", text: "x".repeat(76) },
              value: "value",
            },
          ],
        },
      ],
    },
    "select option label has 76 characters; the limit is 75",
  ],
  [
    "native select option value",
    {
      type: "actions",
      elements: [
        {
          type: "static_select",
          action_id: "select",
          options: [
            {
              text: { type: "plain_text", text: "label" },
              value: "x".repeat(151),
            },
          ],
        },
      ],
    },
    "select option value has 151 characters; the limit is 150",
  ],
  [
    "nested feedback button text",
    {
      type: "context_actions",
      elements: [
        {
          type: "feedback_buttons",
          action_id: "feedback",
          positive_button: {
            text: { type: "plain_text", text: "x".repeat(76) },
            value: "positive",
          },
        },
      ],
    },
    "button text has 76 characters; the limit is 75",
  ],
] as const)(
  "strict raw Slack validation rejects oversized %s",
  (_name, value, message) => {
    const raw = createNativeNode("slack", "raw", "Raw", { value });
    expect(slackRender.renderSlackMessage([raw]).blocks).toHaveLength(1);
    expect(() => slackRender.renderSlackComponentMessage([raw])).toThrow(
      message,
    );
  },
);

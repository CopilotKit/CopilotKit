import { expect, test } from "vitest";
import { createNativeNode } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import * as teamsNative from "./native-codec.js";
import * as teamsRender from "./render/adaptive-card.js";
import * as teams from "./index.js";

function sections(count: number): ChannelNode[] {
  return Array.from({ length: count }, (_, index) => ({
    type: "section",
    props: { children: `Section ${index}` },
  }));
}

test("exports a strict renderer for Channel component revisions", () => {
  expect(teamsRender).toHaveProperty(
    "renderTeamsComponentCard",
    expect.any(Function),
  );
});

test("exports the Teams component edit cadence", () => {
  expect(teams.TEAMS_COMPONENT_EDIT_INTERVAL_MS).toBe(700);
});

test("exports a strict native-card renderer for Channel component revisions", () => {
  expect(teamsNative).toHaveProperty(
    "renderTeamsComponentNativeCard",
    expect.any(Function),
  );
});

test("component rendering rejects portable card bodies that normal rendering clamps", () => {
  const ir = sections(101);

  const normal = teamsRender.renderAdaptiveCard(ir);

  expect(normal.body).toHaveLength(100);
  expect(() => teamsRender.renderTeamsComponentCard(ir)).toThrow(
    "Teams Channel component rendered 101 body elements; the card limit is 100.",
  );
});

test("component rendering rejects oversized native card bodies without changing normal rendering", () => {
  const children = Array.from({ length: 101 }, (_, index) =>
    createNativeNode("teams", "element", "TextBlock", {
      text: `Section ${index}`,
    }),
  );
  const ir = [createNativeNode("teams", "root", "AdaptiveCard", { children })];

  const normal = teamsNative.renderTeamsNativeCard(ir);

  expect(normal.body).toHaveLength(101);
  expect(() => teamsNative.renderTeamsComponentNativeCard(ir)).toThrow(
    "Teams Channel component rendered 101 body elements; the card limit is 100.",
  );
});

test("component rendering rejects Slack native JSX before Teams delivery", () => {
  const slackBlock = createNativeNode("slack", "block", "Section", {});

  expect(() =>
    teamsNative.renderTeamsComponentNativeCard([slackBlock]),
  ).toThrow("Teams delivery cannot render Slack native JSX.");
});

test("component rendering rejects text that normal rendering truncates", () => {
  const ir = sections(1);
  ir[0]!.props.children = {
    type: "text",
    props: { value: "x".repeat(12_001) },
  };

  const normal = teamsRender.renderAdaptiveCard(ir);

  expect((normal.body[0] as { text: string }).text).toHaveLength(12_000);
  expect(() => teamsRender.renderTeamsComponentCard(ir)).toThrow(
    "Teams Channel component text has 12001 characters; the TextBlock limit is 12000.",
  );
});

test("component rendering rejects oversized native text", () => {
  const textBlock = createNativeNode("teams", "element", "TextBlock", {
    text: "x".repeat(12_001),
  });
  const ir = [
    createNativeNode("teams", "root", "AdaptiveCard", {
      children: [textBlock],
    }),
  ];

  expect(teamsNative.renderTeamsNativeCard(ir).body).toHaveLength(1);
  expect(() => teamsNative.renderTeamsComponentNativeCard(ir)).toThrow(
    "Teams Channel component text has 12001 characters; the TextBlock limit is 12000.",
  );
});

test.each([
  [
    "fact value",
    [
      {
        type: "field",
        props: {
          children: {
            type: "text",
            props: { value: `Name: ${"x".repeat(2_001)}` },
          },
        },
      },
    ],
    "fact value",
  ],
  [
    "button title",
    [
      {
        type: "button",
        props: {
          children: { type: "text", props: { value: "x".repeat(257) } },
        },
      },
    ],
    "button title",
  ],
  [
    "choice label",
    [
      {
        type: "select",
        props: { options: [{ label: "x".repeat(257), value: "x" }] },
      },
    ],
    "choice label",
  ],
  [
    "table cell",
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
    "table cell",
  ],
  [
    "chart title",
    [{ type: "chart", props: { title: "x".repeat(201), data: [] } }],
    "chart title",
  ],
  [
    "chart label",
    [
      {
        type: "chart",
        props: { data: [{ label: "x".repeat(201), value: 1 }] },
      },
    ],
    "chart label",
  ],
] as const)(
  "component rendering rejects oversized portable %s",
  (_name, ir, message) => {
    expect(() =>
      teamsRender.renderTeamsComponentCard(ir as unknown as ChannelNode[]),
    ).toThrow(message);
  },
);

test("component rendering rejects inferred table columns that normal rendering clamps", () => {
  const cells = Array.from({ length: 13 }, () => ({
    type: "cell",
    props: { children: "value" },
  }));
  const ir = [
    {
      type: "table",
      props: { children: { type: "row", props: { children: cells } } },
    },
  ] as ChannelNode[];

  expect(
    (teamsRender.renderAdaptiveCard(ir).body[0] as { columns: unknown[] })
      .columns,
  ).toHaveLength(12);
  expect(() => teamsRender.renderTeamsComponentCard(ir)).toThrow(
    "table exceeds 12 columns",
  );
});

test.each([
  [
    "fact value",
    { type: "FactSet", facts: [{ title: "Name", value: "x".repeat(2_001) }] },
    "fact value",
  ],
  [
    "button title",
    {
      type: "ActionSet",
      actions: [{ type: "Action.Submit", title: "x".repeat(257) }],
    },
    "button title",
  ],
  [
    "choice label",
    {
      type: "Input.ChoiceSet",
      choices: [{ title: "x".repeat(257), value: "x" }],
    },
    "choice label",
  ],
  [
    "table cell",
    {
      type: "Table",
      columns: [{}],
      rows: [
        {
          type: "TableRow",
          cells: [
            {
              type: "TableCell",
              items: [{ type: "TextBlock", text: "x".repeat(2_001) }],
            },
          ],
        },
      ],
    },
    "table cell",
  ],
  [
    "chart title",
    { type: "Chart.Pie", title: "x".repeat(201), data: [] },
    "chart title",
  ],
  [
    "chart label",
    { type: "Chart.Pie", data: [{ legend: "x".repeat(201), value: 1 }] },
    "chart label",
  ],
] as const)(
  "strict native card validation rejects oversized %s",
  (_name, element, message) => {
    expect(() =>
      teamsRender.assertTeamsComponentCardBudget({
        type: "AdaptiveCard",
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        version: "1.5",
        body: [element as Record<string, unknown>],
      }),
    ).toThrow(message);
  },
);

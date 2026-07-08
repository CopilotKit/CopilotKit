import { describe, it, expect } from "vitest";
import type { BotNode } from "@copilotkit/channels-ui";
import {
  renderAdaptiveCard,
  isPlainText,
  collectPlainText,
} from "./adaptive-card.js";

const text = (value: string): BotNode => ({ type: "text", props: { value } });
const el = (type: string, children: BotNode[], props = {}): BotNode => ({
  type,
  props: { ...props, children },
});
const chart = (props: Record<string, unknown>): BotNode => ({
  type: "chart",
  props,
});

describe("renderAdaptiveCard", () => {
  it("emits a versioned AdaptiveCard envelope", () => {
    const card = renderAdaptiveCard([text("hi")]);
    expect(card.type).toBe("AdaptiveCard");
    expect(card.version).toBe("1.5");
    expect(Array.isArray(card.body)).toBe(true);
  });

  it("renders a header as a bold large TextBlock", () => {
    const card = renderAdaptiveCard([el("header", [text("Title")])]);
    expect(card.body[0]).toMatchObject({
      type: "TextBlock",
      text: "Title",
      weight: "Bolder",
      size: "Large",
    });
  });

  it("renders section/markdown as wrapped TextBlocks", () => {
    const card = renderAdaptiveCard([el("section", [text("Body copy")])]);
    expect(card.body[0]).toMatchObject({
      type: "TextBlock",
      text: "Body copy",
      wrap: true,
    });
  });

  it("renders <Fields> as a FactSet, splitting 'k: v' into title/value", () => {
    const card = renderAdaptiveCard([
      el("fields", [
        el("field", [text("Status: Open")]),
        el("field", [text("just a value")]),
      ]),
    ]);
    expect(card.body[0]).toMatchObject({
      type: "FactSet",
      facts: [
        { title: "Status", value: "Open" },
        { title: "", value: "just a value" },
      ],
    });
  });

  it("renders a <Button> as a top-level Action.Submit carrying the opaque id", () => {
    const card = renderAdaptiveCard([
      el("actions", [
        el("button", [text("Approve")], {
          onClick: { id: "ck:approve" },
          value: { decision: "yes" },
          style: "primary",
        }),
      ]),
    ]);
    expect(card.body).toHaveLength(0);
    expect(card.actions).toEqual([
      {
        type: "Action.Submit",
        title: "Approve",
        data: { ckActionId: "ck:approve", value: { decision: "yes" } },
        style: "positive",
      },
    ]);
  });

  it("renders a url <Button> as an Action.OpenUrl", () => {
    const card = renderAdaptiveCard([
      el("actions", [
        el("button", [text("Open")], { url: "https://dash/deploy/42" }),
      ]),
    ]);
    expect(card.actions).toEqual([
      { type: "Action.OpenUrl", title: "Open", url: "https://dash/deploy/42" },
    ]);
  });

  it("marks a multi <Select> ChoiceSet as isMultiSelect", () => {
    const card = renderAdaptiveCard([
      el("select", [], {
        multi: true,
        onSelect: { id: "ck:pick" },
        options: [{ label: "One", value: "1" }],
      }),
    ]);
    expect(card.body[0]).toMatchObject({
      type: "Input.ChoiceSet",
      isMultiSelect: true,
    });
  });

  it("renders <Select>/<Input> as body inputs", () => {
    const card = renderAdaptiveCard([
      el("select", [], {
        onSelect: { id: "ck:pick" },
        placeholder: "Choose",
        options: [
          { label: "One", value: "1" },
          { label: "Two", value: "2" },
        ],
      }),
      el("input", [], { onSubmit: { id: "ck:txt" }, multiline: true }),
    ]);
    expect(card.body[0]).toMatchObject({
      type: "Input.ChoiceSet",
      id: "ck:pick",
      placeholder: "Choose",
      choices: [
        { title: "One", value: "1" },
        { title: "Two", value: "2" },
      ],
    });
    expect(card.body[1]).toMatchObject({
      type: "Input.Text",
      id: "ck:txt",
      isMultiline: true,
    });
  });

  it("renders a <Table> as a native Table with a header row", () => {
    const card = renderAdaptiveCard([
      el(
        "table",
        [el("row", [el("cell", [text("a1")]), el("cell", [text("b1")])])],
        {
          columns: [{ header: "A" }, { header: "B", align: "right" }],
        },
      ),
    ]);
    const table = card.body[0] as Record<string, unknown>;
    expect(table.type).toBe("Table");
    expect(table.firstRowAsHeader).toBe(true);
    const rows = table.rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2); // header + 1 data row
    expect(rows[0]!.type).toBe("TableRow");
  });

  it("clamps top-level actions to the Teams ceiling", () => {
    const buttons = Array.from({ length: 10 }, (_, i) =>
      el("button", [text(`b${i}`)], { onClick: { id: `ck:${i}` } }),
    );
    const card = renderAdaptiveCard([el("actions", buttons)]);
    expect(card.actions).toHaveLength(6);
  });

  it("skips unknown intrinsics without throwing", () => {
    const card = renderAdaptiveCard([el("mystery", [text("x")])]);
    expect(card.body).toHaveLength(0);
  });

  it("renders a vertical-bar <Chart> with title and axis titles", () => {
    const card = renderAdaptiveCard([
      chart({
        title: "Tickets",
        xAxisTitle: "Month",
        yAxisTitle: "Count",
        data: [
          { label: "Jan", value: 3 },
          { label: "Feb", value: 7 },
        ],
      }),
    ]);
    expect(card.body[0]).toMatchObject({
      type: "Chart.VerticalBar",
      title: "Tickets",
      showTitle: true,
      showBarValues: true,
      maxWidth: "520px",
      xAxisTitle: "Month",
      yAxisTitle: "Count",
      data: [
        { x: "Jan", y: 3 },
        { x: "Feb", y: 7 },
      ],
    });
  });

  it("defaults an absent chart type to a vertical bar", () => {
    const card = renderAdaptiveCard([
      chart({ title: "T", data: [{ label: "a", value: 1 }] }),
    ]);
    expect((card.body[0] as Record<string, unknown>).type).toBe(
      "Chart.VerticalBar",
    );
  });

  it("maps pie/donut to legend+value slices (no axes)", () => {
    const data = [
      { label: "Open", value: 4 },
      { label: "Closed", value: 6 },
    ];
    const pie = renderAdaptiveCard([chart({ type: "pie", data })]);
    expect(pie.body[0]).toMatchObject({
      type: "Chart.Pie",
      data: [
        { legend: "Open", value: 4 },
        { legend: "Closed", value: 6 },
      ],
    });
    expect((pie.body[0] as Record<string, unknown>).xAxisTitle).toBeUndefined();
    const donut = renderAdaptiveCard([chart({ type: "donut", data })]);
    expect((donut.body[0] as Record<string, unknown>).type).toBe("Chart.Donut");
  });

  it("maps line to a single legended series of values", () => {
    const card = renderAdaptiveCard([
      chart({
        type: "line",
        title: "Revenue",
        data: [{ label: "Q1", value: 100 }],
      }),
    ]);
    expect(card.body[0]).toMatchObject({
      type: "Chart.Line",
      data: [{ legend: "Revenue", values: [{ x: "Q1", y: 100 }] }],
    });
  });

  it("maps horizontalBar to an x/y series", () => {
    const card = renderAdaptiveCard([
      chart({ type: "horizontalBar", data: [{ label: "A", value: 5 }] }),
    ]);
    expect(card.body[0]).toMatchObject({
      type: "Chart.HorizontalBar",
      data: [{ x: "A", y: 5 }],
    });
  });

  it("clamps chart data points to the Teams ceiling", () => {
    const data = Array.from({ length: 80 }, (_, i) => ({
      label: `p${i}`,
      value: i,
    }));
    const card = renderAdaptiveCard([chart({ data })]);
    const points = (card.body[0] as { data: unknown[] }).data;
    expect(points).toHaveLength(50);
  });
});

describe("isPlainText", () => {
  it("is true for text-only trees", () => {
    expect(isPlainText([text("hi")])).toBe(true);
    expect(isPlainText([el("message", [el("section", [text("hi")])])])).toBe(
      true,
    );
  });

  it("is false once any rich element appears", () => {
    expect(isPlainText([el("header", [text("hi")])])).toBe(false);
    expect(isPlainText([el("actions", [el("button", [text("x")])])])).toBe(
      false,
    );
    expect(isPlainText([el("message", [chart({ data: [] })])])).toBe(false);
  });
});

describe("collectPlainText", () => {
  it("joins block text depth-first", () => {
    const ir = [el("message", [el("section", [text("a")]), text("b")])];
    expect(collectPlainText(ir)).toBe("ab");
  });
});

import type { ChannelNode } from "./ir.js";
import { describe, it, expect } from "vitest";
import { renderToIR } from "./render.js";
import {
  Message,
  Header,
  Section,
  Actions,
  Button,
  Divider,
  Table,
  Row,
  Cell,
  Image,
  Select,
  Chart,
  Input,
  isChannelComponent,
  CHANNEL_COMPONENT,
} from "./components.js";

/**
 * Compile-time prop type guards. This arrow is never invoked — the assertions
 * are validated by `tsc` (build / check-types). Each `@ts-expect-error` fails
 * the type-check if the props ever stop being enforced (regression guard); the
 * trailing valid cases fail if a legitimate usage is wrongly rejected.
 */
const __typeGuards = () => {
  // @ts-expect-error unknown prop on a container component
  <Section bogus={1} />;
  // @ts-expect-error invalid Button.style value
  <Button style="nope">x</Button>;
  // @ts-expect-error excess prop on Button
  <Button extra>x</Button>;
  // @ts-expect-error Message.accent must be a string
  <Message accent={1} />;
  // @ts-expect-error Divider takes no children
  <Divider>x</Divider>;
  // @ts-expect-error Image.url is required
  <Image alt="x" />;
  // @ts-expect-error Select.options is required
  <Select placeholder="p" />;
  // @ts-expect-error Chart.data is required
  <Chart title="x" />;
  // @ts-expect-error invalid Chart.type value
  <Chart type="scatter" data={[]} />;

  // Valid usages — must type-check cleanly.
  <Section>hello {42}</Section>;
  <Message accent="#27AE60">
    <Header>Title</Header>
  </Message>;
  <Button style="primary" value={{ ok: true }} onClick={() => {}}>
    Go
  </Button>;
  <Image url="https://example.com/x.png" alt="x" />;
  <Chart
    type="line"
    title="Revenue"
    xAxisTitle="Month"
    yAxisTitle="USD"
    data={[{ label: "Jan", value: 10 }]}
  />;

  // Button.value flows into onClick: ctx.action.value is inferred, not unknown.
  <Button
    value={{ confirmed: true }}
    onClick={(ctx) => {
      ctx.action.value?.confirmed;
      // @ts-expect-error 'nope' is not on the inferred value type
      ctx.action.value?.nope;
    }}
  >
    Confirm
  </Button>;
};
void __typeGuards;

describe("component vocabulary", () => {
  it("Message wraps children with intrinsic type 'message'", () => {
    const out = renderToIR(
      <Message>
        <Header>Hi</Header>
      </Message>,
    );
    expect(out[0]!.type).toBe("message");
  });
  it("Button carries onClick and style in props", () => {
    const fn = () => {};
    const out = renderToIR(
      <Actions>
        <Button onClick={fn} style="primary">
          Go
        </Button>
      </Actions>,
    );
    const actions = out[0]!;
    const button = (actions.props.children as ChannelNode[])[0] as ChannelNode;
    expect(button.type).toBe("button");
    expect(button.props.onClick).toBe(fn);
    expect(button.props.style).toBe("primary");
  });
  it("Divider renders with no children", () => {
    const out = renderToIR(<Divider />);
    expect(out[0]).toMatchObject({ type: "divider" });
  });
  it("Table carries columns and nests Row→Cell→text children", () => {
    const out = renderToIR(
      <Table
        columns={[{ header: "Name" }, { header: "Status", align: "center" }]}
      >
        <Row>
          <Cell>Ana</Cell>
          <Cell>Active</Cell>
        </Row>
      </Table>,
    );
    const table = out[0]!;
    expect(table.type).toBe("table");
    expect((table.props.columns as unknown[]).length).toBe(2);
    const rows = table.props.children as ChannelNode[];
    const row = rows[0]!;
    expect(row.type).toBe("row");
    const cells = row.props.children as ChannelNode[];
    expect(cells.length).toBe(2);
    expect(cells[0]!.type).toBe("cell");
    const cellText = (cells[0]!.props.children as ChannelNode[])[0]!;
    expect(cellText).toMatchObject({ type: "text", props: { value: "Ana" } });
  });
  it("Chart carries type, title, axis titles, and data in props", () => {
    const data = [
      { label: "Jan", value: 10 },
      { label: "Feb", value: 20 },
    ];
    const out = renderToIR(
      <Chart type="line" title="Revenue" yAxisTitle="USD" data={data} />,
    );
    const chart = out[0]!;
    expect(chart.type).toBe("chart");
    expect(chart.props.type).toBe("line");
    expect(chart.props.title).toBe("Revenue");
    expect(chart.props.yAxisTitle).toBe("USD");
    expect(chart.props.data).toEqual(data);
  });
});

describe("component branding", () => {
  it("brands every channel component so it is recognizable", () => {
    for (const c of [
      Message,
      Button,
      Select,
      Input,
      Table,
      Chart,
      Image,
      Divider,
    ]) {
      expect(isChannelComponent(c)).toBe(true);
      expect((c as unknown as Record<symbol, unknown>)[CHANNEL_COMPONENT]).toBe(
        true,
      );
    }
  });

  it("does not brand arbitrary functions", () => {
    const notOurs = (props: { x: number }) => props;
    expect(isChannelComponent(notOurs)).toBe(false);
    expect(isChannelComponent(undefined)).toBe(false);
    expect(isChannelComponent("message")).toBe(false);
  });
});

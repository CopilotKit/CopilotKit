import type { BotNode } from "@copilotkit/channels-ui";
import { TEAMS_LIMITS, truncateText, clampArray } from "./budget.js";

/** Teams attachment content type for an Adaptive Card. */
export const ADAPTIVE_CARD_CONTENT_TYPE =
  "application/vnd.microsoft.card.adaptive";

/** A minimally-typed Adaptive Card (1.5). Elements/actions are open bags: the
 *  schema is large and we only emit a curated subset. */
export interface AdaptiveCard {
  type: "AdaptiveCard";
  $schema: string;
  version: string;
  body: CardElement[];
  actions?: CardAction[];
}
type CardElement = Record<string, unknown>;
type CardAction = Record<string, unknown>;

const SCHEMA = "http://adaptivecards.io/schemas/adaptive-card.json";
const VERSION = "1.5";

/**
 * Render a cross-platform component IR tree (already expanded by `renderToIR`
 * and pre-bound by the action registry, so event props are `{ id }`) into a
 * Teams **Adaptive Card** (1.5).
 *
 * Structural nodes map to body elements (`<Header>`→bold `TextBlock`,
 * `<Section>`/`<Markdown>`→wrapped `TextBlock`, `<Fields>`→`FactSet`,
 * `<Table>`→native `Table`, `<Image>`→`Image`). Interactive nodes split by
 * Adaptive Card shape: `<Button>`→a top-level `Action.Submit` (per the V1
 * decision to use `Action.Submit`), while `<Input>`/`<Select>` become
 * `Input.Text`/`Input.ChoiceSet` in the body. Each action/input carries the
 * registry-stamped opaque id in its `data`/`id` so a later interaction can be
 * decoded back into the engine (round-trip is a follow-up; rendering is here).
 *
 * The renderer is total: unknown intrinsics are skipped. Collections clamp and
 * text truncates to {@link TEAMS_LIMITS} so the card stays within Teams' payload
 * ceiling.
 */
export function renderAdaptiveCard(ir: BotNode[]): AdaptiveCard {
  const body: CardElement[] = [];
  const actions: CardAction[] = [];
  for (const node of ir) renderNode(node, body, actions);

  const card: AdaptiveCard = {
    type: "AdaptiveCard",
    $schema: SCHEMA,
    version: VERSION,
    body: clampArray(body, TEAMS_LIMITS.bodyElements).items,
  };
  const clampedActions = clampArray(actions, TEAMS_LIMITS.actions).items;
  if (clampedActions.length > 0) card.actions = clampedActions;
  return card;
}

/** Render a single IR node, pushing body elements and/or top-level actions. */
function renderNode(
  node: BotNode,
  body: CardElement[],
  actions: CardAction[],
): void {
  if (typeof node.type !== "string") return; // non-intrinsic, already expanded
  const props = node.props ?? {};
  switch (node.type) {
    case "message":
      // The message container is not an element; flatten its children.
      for (const child of childNodes(node)) renderNode(child, body, actions);
      return;
    case "header":
      body.push({
        type: "TextBlock",
        text: truncateText(collectText(node), TEAMS_LIMITS.textBlock),
        size: "Large",
        weight: "Bolder",
        wrap: true,
      });
      return;
    case "section":
    case "markdown":
      body.push(textBlock(collectText(node)));
      return;
    case "text":
      body.push(textBlock(String(props.value ?? "")));
      return;
    case "context":
      body.push({
        type: "TextBlock",
        text: truncateText(collectText(node), TEAMS_LIMITS.textBlock),
        size: "Small",
        isSubtle: true,
        wrap: true,
      });
      return;
    case "divider":
      // Adaptive Cards has no rule element; a separator line is drawn *above*
      // an element via `separator: true`. An empty, separated TextBlock reads
      // as a horizontal divider.
      body.push({
        type: "TextBlock",
        text: " ",
        separator: true,
        spacing: "Medium",
      });
      return;
    case "image":
      body.push({
        type: "Image",
        url: String(props.url ?? props.image_url ?? ""),
        altText: String(props.alt ?? props.altText ?? ""),
        size: "Auto",
      });
      return;
    case "fields":
      body.push(factSet(childNodes(node).filter((c) => c.type === "field")));
      return;
    case "field":
      body.push(factSet([node]));
      return;
    case "table":
      body.push(renderTable(node));
      return;
    case "chart":
      body.push(renderChart(node));
      return;
    case "actions":
      for (const child of childNodes(node)) renderNode(child, body, actions);
      return;
    case "button":
      actions.push(renderButton(node));
      return;
    case "select":
      body.push(renderSelect(node));
      return;
    case "input":
      body.push(renderInput(node));
      return;
    default:
      // Unknown intrinsic: skip (total renderer).
      return;
  }
}

function textBlock(text: string): CardElement {
  return {
    type: "TextBlock",
    text: truncateText(text, TEAMS_LIMITS.textBlock),
    wrap: true,
  };
}

/** A `<Fields>`/`<Field>` group → a `FactSet`. Each field's text is split on
 *  its first colon into title/value (falling back to a value-only fact). */
function factSet(fieldNodes: BotNode[]): CardElement {
  const { items } = clampArray(fieldNodes, TEAMS_LIMITS.factsPerSet);
  const facts = items.map((f) => {
    const text = collectText(f);
    const idx = text.indexOf(":");
    if (idx > 0 && idx <= 60) {
      return {
        title: truncateText(text.slice(0, idx).trim(), TEAMS_LIMITS.factTitle),
        value: truncateText(text.slice(idx + 1).trim(), TEAMS_LIMITS.factValue),
      };
    }
    return { title: "", value: truncateText(text, TEAMS_LIMITS.factValue) };
  });
  return { type: "FactSet", facts };
}

function renderButton(node: BotNode): CardAction {
  const props = node.props ?? {};
  // Link button → Action.OpenUrl (opens the URL; carries no submit data).
  if (typeof props.url === "string" && props.url.length > 0) {
    return {
      type: "Action.OpenUrl",
      title: truncateText(collectText(node), TEAMS_LIMITS.buttonText),
      url: props.url,
    };
  }
  const action: CardAction = {
    type: "Action.Submit",
    title: truncateText(collectText(node), TEAMS_LIMITS.buttonText),
  };
  // Forward-ready: carry the opaque action id + value so a later
  // `decodeInteraction` can route the submit back into the engine.
  const id = idFromHandler(props.onClick);
  const data: Record<string, unknown> = {};
  if (id) data.ckActionId = id;
  if (props.value !== undefined) data.value = props.value;
  if (Object.keys(data).length > 0) action.data = data;
  if (props.style === "danger" || props.style === "destructive") {
    action.style = "destructive";
  } else if (props.style === "primary") {
    action.style = "positive";
  }
  return action;
}

function renderSelect(node: BotNode): CardElement {
  const props = node.props ?? {};
  const options =
    (props.options as { label: string; value: unknown }[] | undefined) ?? [];
  const { items } = clampArray(options, TEAMS_LIMITS.choices);
  const el: CardElement = {
    type: "Input.ChoiceSet",
    id: idFromHandler(props.onSelect) ?? "select",
    choices: items.map((o) => ({
      title: truncateText(String(o.label), TEAMS_LIMITS.choiceLabel),
      value: String(o.value),
    })),
  };
  // Multi-select: Teams submits the chosen values as a comma-joined string.
  if (props.multi) el.isMultiSelect = true;
  if (props.placeholder) el.placeholder = String(props.placeholder);
  return el;
}

function renderInput(node: BotNode): CardElement {
  const props = node.props ?? {};
  const el: CardElement = {
    type: "Input.Text",
    id: idFromHandler(props.onSubmit) ?? "input",
  };
  if (props.placeholder) el.placeholder = String(props.placeholder);
  if (props.multiline) el.isMultiline = true;
  return el;
}

/** A `<Table>` → a native Adaptive Cards `Table` (1.5). */
function renderTable(node: BotNode): CardElement {
  const props = node.props ?? {};
  const cell = (text: string, header = false): Record<string, unknown> => ({
    type: "TableCell",
    items: [
      {
        type: "TextBlock",
        text: truncateText(text, TEAMS_LIMITS.cellText),
        wrap: true,
        ...(header ? { weight: "Bolder" } : {}),
      },
    ],
  });

  const columnsProp = props.columns as
    | { header: string; align?: "left" | "center" | "right" }[]
    | undefined;
  const columns = columnsProp
    ? clampArray(columnsProp, TEAMS_LIMITS.tableColumns).items
    : undefined;

  const rows: Record<string, unknown>[] = [];
  if (columns && columns.length > 0) {
    rows.push({
      type: "TableRow",
      cells: columns.map((c) => cell(c.header, true)),
    });
  }
  const rowNodes = childNodes(node).filter((c) => c.type === "row");
  const { items: dataRows } = clampArray(rowNodes, TEAMS_LIMITS.tableRows);
  for (const rowNode of dataRows) {
    const cells = childNodes(rowNode).filter((c) => c.type === "cell");
    rows.push({
      type: "TableRow",
      cells: cells.map((c) => cell(collectText(c))),
    });
  }

  const table: CardElement = {
    type: "Table",
    columns: (columns ?? inferColumns(rowNodes)).map((c) => ({
      width: 1,
      ...(typeof c === "object" && "align" in c && c.align
        ? { horizontalCellContentAlignment: capitalize(c.align) }
        : {}),
    })),
    rows,
    firstRowAsHeader: !!(columns && columns.length > 0),
    gridStyle: "default",
  };
  return table;
}

/**
 * A `<Chart>` → a native Teams chart element (`Chart.VerticalBar` /
 * `Chart.HorizontalBar` / `Chart.Line` / `Chart.Pie` / `Chart.Donut`). These
 * are a Teams host extension: they render in Teams clients whose app manifest
 * opts into chart support; other Adaptive Card hosts ignore the unknown
 * element. Data points clamp and labels/title truncate to the budget.
 */
function renderChart(node: BotNode): CardElement {
  const props = node.props ?? {};
  const type = String(props.type ?? "verticalBar");
  const title =
    props.title != null && String(props.title).length > 0
      ? truncateText(String(props.title), TEAMS_LIMITS.chartTitle)
      : undefined;

  const rawData = Array.isArray(props.data)
    ? (props.data as { label?: unknown; value?: unknown }[])
    : [];
  const { items } = clampArray(rawData, TEAMS_LIMITS.chartDataPoints);
  const points = items.map((p) => ({
    label: truncateText(String(p?.label ?? ""), TEAMS_LIMITS.chartLabel),
    value: Number.isFinite(Number(p?.value)) ? Number(p?.value) : 0,
  }));

  // Fields shared by every chart kind. `showTitle` is meaningless without a
  // title; `maxWidth` keeps the chart from stretching the whole card.
  const common: CardElement = { maxWidth: "520px" };
  if (title !== undefined) {
    common.title = title;
    common.showTitle = true;
  }
  // Axis titles apply to the cartesian charts (bar/line), not pie/donut.
  const withAxes = (el: CardElement): CardElement => {
    if (props.xAxisTitle != null) el.xAxisTitle = String(props.xAxisTitle);
    if (props.yAxisTitle != null) el.yAxisTitle = String(props.yAxisTitle);
    return el;
  };
  const xy = points.map((p) => ({ x: p.label, y: p.value }));
  const slices = points.map((p) => ({ legend: p.label, value: p.value }));

  switch (type) {
    case "horizontalBar":
      return withAxes({ ...common, type: "Chart.HorizontalBar", data: xy });
    case "line":
      return withAxes({
        ...common,
        type: "Chart.Line",
        data: [{ legend: title ?? "", values: xy }],
      });
    case "pie":
      return { ...common, type: "Chart.Pie", data: slices };
    case "donut":
      return { ...common, type: "Chart.Donut", data: slices };
    default:
      // verticalBar — also the fallback for any unrecognized type.
      return withAxes({
        ...common,
        type: "Chart.VerticalBar",
        showBarValues: true,
        data: xy,
      });
  }
}

/** When no explicit `columns` are given, size the grid to the widest row. */
function inferColumns(rowNodes: BotNode[]): { align?: undefined }[] {
  let widest = 0;
  for (const r of rowNodes) {
    const n = childNodes(r).filter((c) => c.type === "cell").length;
    if (n > widest) widest = n;
  }
  return Array.from(
    { length: Math.min(widest, TEAMS_LIMITS.tableColumns) },
    () => ({}),
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Extract `{ id }` stamped onto an event prop by the action registry, if present. */
function idFromHandler(handler: unknown): string | undefined {
  if (handler && typeof handler === "object" && "id" in handler) {
    const id = (handler as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

/** The expanded `children` of an IR node as a `BotNode[]` (empty if none). */
function childNodes(node: BotNode): BotNode[] {
  const children = node.props?.children;
  if (Array.isArray(children)) return children as BotNode[];
  if (
    children &&
    typeof children === "object" &&
    "type" in (children as object)
  ) {
    return [children as BotNode];
  }
  return [];
}

/** Concatenate the `value` of all descendant `text` nodes (depth-first). */
function collectText(node: BotNode): string {
  if (typeof node.type === "string" && node.type === "text") {
    return String(node.props?.value ?? "");
  }
  let acc = "";
  for (const child of childNodes(node)) acc += collectText(child);
  return acc;
}

/**
 * Does this IR collapse to plain text (no structural or interactive elements)?
 * Such replies are sent as a normal Teams text activity rather than wrapped in
 * an Adaptive Card. A bare `Echo: hi` shouldn't render as a card.
 */
export function isPlainText(ir: BotNode[]): boolean {
  const RICH = new Set([
    "header",
    "fields",
    "field",
    "table",
    "row",
    "cell",
    "chart",
    "image",
    "actions",
    "button",
    "select",
    "input",
    "divider",
    "context",
  ]);
  const visit = (node: BotNode): boolean => {
    if (typeof node.type === "string" && RICH.has(node.type)) return false;
    return childNodes(node).every(visit);
  };
  return ir.every(visit);
}

/** Plain-text projection of an IR tree (depth-first text, blocks joined). */
export function collectPlainText(ir: BotNode[]): string {
  return ir
    .map((n) => collectText(n))
    .filter((s) => s.length > 0)
    .join("\n\n")
    .trim();
}

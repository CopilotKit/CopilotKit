import type { ChannelNode } from "@copilotkit/channels-ui";
import {
  TEAMS_LIMITS,
  truncateText,
  clampArray,
  jsonByteLength,
} from "./budget.js";

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

interface RenderContext {
  nextFieldIndex: number;
  usedFieldIds: Set<string>;
}

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
export function renderAdaptiveCard(ir: ChannelNode[]): AdaptiveCard {
  return renderAdaptiveCardWithOverflow(ir, "clamp");
}

function renderAdaptiveCardWithOverflow(
  ir: ChannelNode[],
  overflowMode: "clamp" | "error",
): AdaptiveCard {
  if (overflowMode === "error") assertTeamsPortableBudgets(ir);
  const body: CardElement[] = [];
  const actions: CardAction[] = [];
  const context: RenderContext = {
    nextFieldIndex: 0,
    usedFieldIds: new Set(["ckActionId", "value"]),
  };
  for (const node of ir) renderNode(node, body, actions, context);

  if (overflowMode === "error" && body.length > TEAMS_LIMITS.bodyElements) {
    throw new Error(
      `Teams Channel component rendered ${body.length} body elements; the card limit is ${TEAMS_LIMITS.bodyElements}.`,
    );
  }
  if (overflowMode === "error" && actions.length > TEAMS_LIMITS.actions) {
    throw new Error(
      `Teams Channel component rendered ${actions.length} actions; the card limit is ${TEAMS_LIMITS.actions}.`,
    );
  }

  const card: AdaptiveCard = {
    type: "AdaptiveCard",
    $schema: SCHEMA,
    version: VERSION,
    body: clampArray(body, TEAMS_LIMITS.bodyElements).items,
  };
  const clampedActions = clampArray(actions, TEAMS_LIMITS.actions).items;
  if (clampedActions.length > 0) card.actions = clampedActions;
  if (overflowMode === "error") assertTeamsComponentCardBudget(card);
  return card;
}

function assertTeamsPortableBudgets(nodes: readonly ChannelNode[]): void {
  for (const node of nodes) {
    if (typeof node.type === "string") {
      const text =
        node.type === "text"
          ? String(node.props.value ?? "")
          : collectText(node);
      if (
        ["header", "section", "markdown", "text", "context"].includes(
          node.type,
        ) &&
        text.length > TEAMS_LIMITS.textBlock
      ) {
        throw new Error(
          `Teams Channel component text has ${text.length} characters; the TextBlock limit is ${TEAMS_LIMITS.textBlock}.`,
        );
      }
      const children = childNodes(node);
      if (
        node.type === "fields" &&
        children.filter((child) => child.type === "field").length >
          TEAMS_LIMITS.factsPerSet
      ) {
        throw new Error(
          `Teams Channel component FactSet exceeds ${TEAMS_LIMITS.factsPerSet} facts.`,
        );
      }
      if (node.type === "field") {
        const fact = splitFactText(collectText(node));
        assertTeamsTextBudget("fact title", fact.title, TEAMS_LIMITS.factTitle);
        assertTeamsTextBudget("fact value", fact.value, TEAMS_LIMITS.factValue);
      }
      if (node.type === "button") {
        assertTeamsTextBudget(
          "button title",
          collectText(node),
          TEAMS_LIMITS.buttonText,
        );
      }
      if (node.type === "select" && Array.isArray(node.props.options)) {
        if (node.props.options.length > TEAMS_LIMITS.choices) {
          throw new Error(
            `Teams Channel component select exceeds ${TEAMS_LIMITS.choices} choices.`,
          );
        }
        for (const option of node.props.options as Array<{ label?: unknown }>) {
          assertTeamsTextBudget(
            "choice label",
            String(option.label ?? ""),
            TEAMS_LIMITS.choiceLabel,
          );
        }
      }
      if (node.type === "table") {
        const columns = Array.isArray(node.props.columns)
          ? node.props.columns.length
          : 0;
        const rowNodes = children.filter((child) => child.type === "row");
        const rows =
          rowNodes.length +
          (Array.isArray(node.props.columns) && node.props.columns.length > 0
            ? 1
            : 0);
        const inferredColumns = rowNodes.reduce(
          (widest, row) =>
            Math.max(
              widest,
              childNodes(row).filter((child) => child.type === "cell").length,
            ),
          0,
        );
        if (Math.max(columns, inferredColumns) > TEAMS_LIMITS.tableColumns) {
          throw new Error(
            `Teams Channel component table exceeds ${TEAMS_LIMITS.tableColumns} columns.`,
          );
        }
        if (rows > TEAMS_LIMITS.tableRows) {
          throw new Error(
            `Teams Channel component table exceeds ${TEAMS_LIMITS.tableRows} rows.`,
          );
        }
        for (const column of Array.isArray(node.props.columns)
          ? (node.props.columns as Array<{ header?: unknown }>)
          : []) {
          assertTeamsTextBudget(
            "table cell",
            String(column.header ?? ""),
            TEAMS_LIMITS.cellText,
          );
        }
        for (const row of rowNodes) {
          for (const cell of childNodes(row).filter(
            (child) => child.type === "cell",
          )) {
            assertTeamsTextBudget(
              "table cell",
              collectText(cell),
              TEAMS_LIMITS.cellText,
            );
          }
        }
      }
      if (node.type === "chart" && Array.isArray(node.props.data)) {
        if (node.props.data.length > TEAMS_LIMITS.chartDataPoints) {
          throw new Error(
            `Teams Channel component chart exceeds ${TEAMS_LIMITS.chartDataPoints} data points.`,
          );
        }
        assertTeamsTextBudget(
          "chart title",
          String(node.props.title ?? ""),
          TEAMS_LIMITS.chartTitle,
        );
        for (const point of node.props.data as Array<{ label?: unknown }>) {
          assertTeamsTextBudget(
            "chart label",
            String(point.label ?? ""),
            TEAMS_LIMITS.chartLabel,
          );
        }
      }
      assertTeamsPortableBudgets(children);
    }
  }
}

/** Render one portable Channel component revision as an Adaptive Card. */
export function renderTeamsComponentCard(ir: ChannelNode[]): AdaptiveCard {
  return renderAdaptiveCardWithOverflow(ir, "error");
}

/** Reject an Adaptive Card that exceeds component-only provider budgets. */
export function assertTeamsComponentCardBudget(card: AdaptiveCard): void {
  if (card.body.length > TEAMS_LIMITS.bodyElements) {
    throw new Error(
      `Teams Channel component rendered ${card.body.length} body elements; the card limit is ${TEAMS_LIMITS.bodyElements}.`,
    );
  }
  if ((card.actions?.length ?? 0) > TEAMS_LIMITS.actions) {
    throw new Error(
      `Teams Channel component rendered ${card.actions?.length ?? 0} actions; the card limit is ${TEAMS_LIMITS.actions}.`,
    );
  }
  const bytes = jsonByteLength(card);
  if (bytes > TEAMS_LIMITS.cardBytes) {
    throw new Error(
      `Teams Channel component rendered ${bytes} bytes; the Adaptive Card limit is ${TEAMS_LIMITS.cardBytes}.`,
    );
  }
  assertTeamsRenderedComponentBudget(card);
}

function assertTeamsRenderedComponentBudget(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) assertTeamsRenderedComponentBudget(child);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  if (
    record.type === "TextBlock" &&
    typeof record.text === "string" &&
    record.text.length > TEAMS_LIMITS.textBlock
  ) {
    throw new Error(
      `Teams Channel component text has ${record.text.length} characters; the TextBlock limit is ${TEAMS_LIMITS.textBlock}.`,
    );
  }
  if (record.type === "FactSet" && Array.isArray(record.facts)) {
    if (record.facts.length > TEAMS_LIMITS.factsPerSet) {
      throw new Error(
        `Teams Channel component FactSet exceeds ${TEAMS_LIMITS.factsPerSet} facts.`,
      );
    }
    for (const fact of record.facts) {
      if (typeof fact !== "object" || fact === null) continue;
      const item = fact as Record<string, unknown>;
      assertTeamsTextBudget(
        "fact title",
        String(item.title ?? ""),
        TEAMS_LIMITS.factTitle,
      );
      assertTeamsTextBudget(
        "fact value",
        String(item.value ?? ""),
        TEAMS_LIMITS.factValue,
      );
    }
  }
  if (typeof record.type === "string" && record.type.startsWith("Action.")) {
    assertTeamsTextBudget(
      "button title",
      String(record.title ?? ""),
      TEAMS_LIMITS.buttonText,
    );
  }
  if (record.type === "ActionSet" && Array.isArray(record.actions)) {
    assertTeamsCollectionBudget(
      "actions",
      record.actions.length,
      TEAMS_LIMITS.actions,
    );
  }
  if (record.type === "Input.ChoiceSet" && Array.isArray(record.choices)) {
    assertTeamsCollectionBudget(
      "choices",
      record.choices.length,
      TEAMS_LIMITS.choices,
    );
    for (const choice of record.choices) {
      if (typeof choice !== "object" || choice === null) continue;
      assertTeamsTextBudget(
        "choice label",
        String((choice as Record<string, unknown>).title ?? ""),
        TEAMS_LIMITS.choiceLabel,
      );
    }
  }
  if (record.type === "Table") {
    assertTeamsCollectionBudget(
      "table columns",
      Array.isArray(record.columns) ? record.columns.length : 0,
      TEAMS_LIMITS.tableColumns,
    );
    assertTeamsCollectionBudget(
      "table rows",
      Array.isArray(record.rows) ? record.rows.length : 0,
      TEAMS_LIMITS.tableRows,
    );
  }
  if (record.type === "TableRow" && Array.isArray(record.cells)) {
    assertTeamsCollectionBudget(
      "table columns",
      record.cells.length,
      TEAMS_LIMITS.tableColumns,
    );
  }
  if (record.type === "TableCell" && Array.isArray(record.items)) {
    for (const item of record.items) {
      if (typeof item !== "object" || item === null) continue;
      const child = item as Record<string, unknown>;
      if (child.type === "TextBlock") {
        assertTeamsTextBudget(
          "table cell",
          String(child.text ?? ""),
          TEAMS_LIMITS.cellText,
        );
      }
    }
  }
  if (typeof record.type === "string" && record.type.startsWith("Chart.")) {
    assertTeamsTextBudget(
      "chart title",
      String(record.title ?? ""),
      TEAMS_LIMITS.chartTitle,
    );
    assertTeamsChartLabels(record.data);
  }
  for (const child of Object.values(record)) {
    assertTeamsRenderedComponentBudget(child);
  }
}

function assertTeamsTextBudget(
  kind: string,
  text: string,
  limit: number,
): void {
  if (text.length > limit) {
    throw new Error(
      `Teams Channel component ${kind} has ${text.length} characters; the limit is ${limit}.`,
    );
  }
}

function assertTeamsCollectionBudget(
  kind: string,
  count: number,
  limit: number,
): void {
  if (count > limit) {
    throw new Error(
      `Teams Channel component ${kind} has ${count} items; the limit is ${limit}.`,
    );
  }
}

function assertTeamsChartLabels(value: unknown): void {
  if (Array.isArray(value)) {
    if (value.length > TEAMS_LIMITS.chartDataPoints) {
      throw new Error(
        `Teams Channel component chart exceeds ${TEAMS_LIMITS.chartDataPoints} data points.`,
      );
    }
    for (const child of value) assertTeamsChartLabels(child);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  for (const key of ["label", "legend", "x"] as const) {
    if (key in record) {
      assertTeamsTextBudget(
        "chart label",
        String(record[key] ?? ""),
        TEAMS_LIMITS.chartLabel,
      );
    }
  }
  for (const child of Object.values(record)) assertTeamsChartLabels(child);
}

/** Render a single IR node, pushing body elements and/or top-level actions. */
function renderNode(
  node: ChannelNode,
  body: CardElement[],
  actions: CardAction[],
  context: RenderContext,
): void {
  if (typeof node.type !== "string") return; // non-intrinsic, already expanded
  const props = node.props ?? {};
  switch (node.type) {
    case "message":
      // The message container is not an element; flatten its children.
      for (const child of childNodes(node))
        renderNode(child, body, actions, context);
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
      for (const child of childNodes(node))
        renderNode(child, body, actions, context);
      return;
    case "button":
      actions.push(renderButton(node));
      return;
    case "select":
      body.push(
        renderSelect(node, fieldId(node, "onSelect", "select", context)),
      );
      return;
    case "input":
      body.push(renderInput(node, fieldId(node, "onSubmit", "input", context)));
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
function factSet(fieldNodes: ChannelNode[]): CardElement {
  const { items } = clampArray(fieldNodes, TEAMS_LIMITS.factsPerSet);
  const facts = items.map((f) => {
    const fact = splitFactText(collectText(f));
    return {
      title: truncateText(fact.title, TEAMS_LIMITS.factTitle),
      value: truncateText(fact.value, TEAMS_LIMITS.factValue),
    };
  });
  return { type: "FactSet", facts };
}

function splitFactText(text: string): { title: string; value: string } {
  const idx = text.indexOf(":");
  return idx > 0 && idx <= 60
    ? { title: text.slice(0, idx).trim(), value: text.slice(idx + 1).trim() }
    : { title: "", value: text };
}

function renderButton(node: ChannelNode): CardAction {
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

function renderSelect(node: ChannelNode, id: string): CardElement {
  const props = node.props ?? {};
  const options =
    (props.options as { label: string; value: unknown }[] | undefined) ?? [];
  const { items } = clampArray(options, TEAMS_LIMITS.choices);
  const el: CardElement = {
    type: "Input.ChoiceSet",
    id,
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

function renderInput(node: ChannelNode, id: string): CardElement {
  const props = node.props ?? {};
  const el: CardElement = {
    type: "Input.Text",
    id,
  };
  if (props.placeholder) el.placeholder = String(props.placeholder);
  if (props.multiline) el.isMultiline = true;
  return el;
}

function fieldId(
  node: ChannelNode,
  handlerProp: "onSelect" | "onSubmit",
  fallback: "select" | "input",
  context: RenderContext,
): string {
  const props = node.props ?? {};
  const index = ++context.nextFieldIndex;
  const rawName = typeof props.name === "string" ? props.name.trim() : "";
  const explicitName =
    rawName && rawName !== "ckActionId" && rawName !== "value"
      ? rawName
      : undefined;
  const base =
    explicitName ?? idFromHandler(props[handlerProp]) ?? `${fallback}_${index}`;
  let candidate = base;
  let suffix = 1;
  while (context.usedFieldIds.has(candidate)) {
    candidate = `${base}_${suffix++}`;
  }
  context.usedFieldIds.add(candidate);
  return candidate;
}

/** A `<Table>` → a native Adaptive Cards `Table` (1.5). */
function renderTable(node: ChannelNode): CardElement {
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
function renderChart(node: ChannelNode): CardElement {
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
function inferColumns(rowNodes: ChannelNode[]): { align?: undefined }[] {
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

/** The expanded `children` of an IR node as a `ChannelNode[]` (empty if none). */
function childNodes(node: ChannelNode): ChannelNode[] {
  const children = node.props?.children;
  if (Array.isArray(children)) return children as ChannelNode[];
  if (
    children &&
    typeof children === "object" &&
    "type" in (children as object)
  ) {
    return [children as ChannelNode];
  }
  return [];
}

/** Concatenate the `value` of all descendant `text` nodes (depth-first). */
function collectText(node: ChannelNode): string {
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
export function isPlainText(ir: ChannelNode[]): boolean {
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
  const visit = (node: ChannelNode): boolean => {
    if (typeof node.type === "string" && RICH.has(node.type)) return false;
    return childNodes(node).every(visit);
  };
  return ir.every(visit);
}

/** Plain-text projection of an IR tree (depth-first text, blocks joined). */
export function collectPlainText(ir: ChannelNode[]): string {
  return ir
    .map((n) => collectText(n))
    .filter((s) => s.length > 0)
    .join("\n\n")
    .trim();
}

import type { ChannelNode } from "@copilotkit/channels-ui";
import { CARD_ENVELOPE_KEYS } from "../interaction.js";
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

interface RenderContext {
  nextFieldIndex: number;
  usedFieldIds: Set<string>;
  /**
   * Fields (`<Input>`/`<Select>`) that both carry a registry-minted handler and
   * can produce a value, in render order: the card `id` minted for the element
   * paired with the action id its handler was stamped with (the two differ
   * whenever `fieldId` used a `name` prop or a dedupe suffix). Used to
   * synthesize a submit for a card that has no dispatchable one. Only the first
   * entry that survived the body clamp is bound — see `synthesizeSubmit`.
   */
  boundFields: { fieldId: string; actionId: string }[];
}

const SCHEMA = "http://adaptivecards.io/schemas/adaptive-card.json";
const VERSION = "1.5";
/** Title of the submit synthesized for a card whose only controls are inputs. */
const SYNTHETIC_SUBMIT_TITLE = "Submit";

/**
 * Render a cross-platform component IR tree (already expanded by `renderToIR`
 * and pre-bound by the action registry, so event props are `{ id }`) into a
 * Teams **Adaptive Card** (1.5).
 *
 * Structural nodes map to body elements (`<Header>`→bold `TextBlock`,
 * `<Section>`/`<Markdown>` and a bare text child→wrapped `TextBlock`,
 * `<Context>`→small subtle `TextBlock`, `<Divider>`→a blank separated
 * `TextBlock`, `<Fields>`/`<Field>`→`FactSet`, `<Table>`→native `Table`,
 * `<Chart>`→a Teams `Chart.*` host element, `<Image>`→`Image`). Interactive
 * nodes split by Adaptive Card shape: `<Button>`→a top-level action — an
 * `Action.Submit` (per the V1 decision to use `Action.Submit`, not
 * `Action.Execute`), or an `Action.OpenUrl` when it is a link button — while
 * `<Input>`/`<Select>` become `Input.Text`/`Input.ChoiceSet` in the body.
 *
 * An emitted `Action.Submit` carries the registry-stamped opaque id in its
 * `data.ckActionId`, so a later interaction can be decoded back into the engine
 * by `parseCardAction`; an `Action.OpenUrl` carries no `data` and never
 * round-trips. A field's `id` is a separate, card-local name minted by
 * `fieldId` — the explicit `name` prop when given, else the stamped id, else a
 * positional `input_N`/`select_N`, plus a `_1`, `_2`, … suffix on collision —
 * so it coincides with the stamped id only in the middle case, and then only
 * when no suffix was needed. A card whose only controls are inputs gets a
 * synthesized `Action.Submit`, which carries both ids (see `synthesizeSubmit`)
 * and without which Teams offers no way to submit the card at all.
 *
 * A control that cannot route its interaction anywhere is not emitted as one: a
 * `<Button>` with neither a `url` nor an `onClick` is dropped (see
 * `renderButton`). A field is different — it is always rendered, and only its
 * candidacy to back the synthesized submit is conditional, on both carrying a
 * stamped handler id and being able to produce a value (see `fieldId`).
 *
 * The renderer is total: unknown intrinsics are skipped. Collections clamp to
 * {@link TEAMS_LIMITS} and displayed prose truncates to it — TextBlock text,
 * fact titles/values, button titles, table cells, choice labels and chart
 * titles/labels — so the card stays within Teams' payload ceiling. Other
 * author-supplied strings pass through unbounded: `placeholder`, a choice's
 * `value`, an `<Image>`'s `url`/`altText`, a chart's axis titles, and a
 * `<Button value>`.
 */
export function renderAdaptiveCard(ir: ChannelNode[]): AdaptiveCard {
  const body: CardElement[] = [];
  const actions: CardAction[] = [];
  const context: RenderContext = {
    nextFieldIndex: 0,
    usedFieldIds: new Set(CARD_ENVELOPE_KEYS),
    boundFields: [],
  };
  for (const node of ir) renderNode(node, body, actions, context);

  const clampedBody = clampArray(body, TEAMS_LIMITS.bodyElements).items;
  const card: AdaptiveCard = {
    type: "AdaptiveCard",
    $schema: SCHEMA,
    version: VERSION,
    body: clampedBody,
  };
  // Decide synthesis against the UNCLAMPED actions: a dispatchable `<Button>`
  // pushed past the ceiling below is still the handler the author bound, and
  // synthesizing from an input would dispatch the input's handler in its place.
  // Such a card keeps the author's action order, so the overflowing button's
  // handler still never fires — but a wrong dispatch is worse than none.
  const synthesized = actions.some(isDispatchableSubmit)
    ? undefined
    : synthesizeSubmit(clampedBody, context);
  // One clamp governs the emitted list, with the synthesized submit's slot
  // reserved inside the ceiling: appending it afterwards would emit
  // `TEAMS_LIMITS.actions + 1` actions, and letting the clamp choose between
  // them could drop the card's only route back into the engine.
  const clampedActions = clampArray(
    actions,
    TEAMS_LIMITS.actions - (synthesized ? 1 : 0),
  ).items;
  if (synthesized) clampedActions.push(synthesized);
  if (clampedActions.length > 0) card.actions = clampedActions;
  return card;
}

/**
 * The `Action.Submit` to add to a card that has none it can dispatch, or
 * `undefined` when no rendered field can back one.
 *
 * Adaptive Cards has no per-input submit affordance: an `Input.*` only reaches
 * us when some `Action.Submit` on the card fires, and Teams merges every input
 * into that submit's payload. A card with no *dispatchable* submit therefore
 * cannot deliver its inputs anywhere — synthesize one, naming the field whose
 * text becomes the action's value (an absent button value would otherwise
 * reach a `ClickHandler<string>` as `undefined`).
 *
 * "Dispatchable" is the caller's test, not "has actions": a link `<Button>`
 * renders as `Action.OpenUrl`, which opens a URL and submits nothing, so one
 * beside an `<Input>` would otherwise reproduce the original defect. (A
 * `<Button>` that routes nowhere is not emitted at all — see `renderButton`.)
 *
 * This covers `<Select>` too, since it is unsubmittable for the same reason,
 * but only when it has something to pick: an option-less one is still rendered
 * as an empty `Input.ChoiceSet`, but `renderNode` withholds it from the
 * candidate pool, since its (absent) choice would reach its handler as
 * `undefined`. Note a `<Select multi>` still arrives as Teams' comma-joined
 * string rather than the `string[]` `onSelect` declares — a pre-existing Teams
 * fidelity gap (see `renderSelect`) that this only makes reachable, not worse.
 */
function synthesizeSubmit(
  clampedBody: CardElement[],
  context: RenderContext,
): CardAction | undefined {
  // Only a field that survived the body clamp can back a submit; a dropped
  // one would render a Submit with nothing above it.
  const rendered = new Set(
    clampedBody
      .map((element) => element.id)
      .filter((id): id is string => typeof id === "string"),
  );
  // One submit per card, bound to the FIRST handler-bound field: Adaptive
  // Cards fires a single action, and a button per input would be nonsense UI.
  // Later fields' handlers therefore never fire — but their text is not lost,
  // since Teams merges every input into this submit and `parseCardAction`
  // surfaces them all as the event's `values`.
  const field = context.boundFields.find((f) => rendered.has(f.fieldId));
  if (!field) return undefined;
  return {
    type: "Action.Submit",
    title: SYNTHETIC_SUBMIT_TITLE,
    data: { ckActionId: field.actionId, ckValueField: field.fieldId },
  };
}

/**
 * Can this action route an interaction back into the engine when it fires?
 * `renderButton` only emits a submit that can, so the `data` test holds by
 * construction; it is checked here so the predicate stands on its own.
 */
function isDispatchableSubmit(action: CardAction): boolean {
  if (action.type !== "Action.Submit") return false;
  const data = action.data as { ckActionId?: unknown } | undefined;
  return typeof data?.ckActionId === "string";
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
    case "button": {
      // Absent for a button that can route nowhere — see `renderButton`.
      const action = renderButton(node);
      if (action) actions.push(action);
      return;
    }
    case "select": {
      // An option-less ChoiceSet offers nothing to pick, so it can never carry
      // a value and must not back a synthesized submit.
      const options = props.options;
      const pickable = Array.isArray(options) && options.length > 0;
      body.push(
        renderSelect(
          node,
          fieldId(node, "onSelect", "select", context, pickable),
        ),
      );
      return;
    }
    case "input":
      // An Input.Text always submits a string (empty when untouched), so it
      // never fails the can-produce-a-value test. Candidacy still needs a
      // minted handler id, which `fieldId` checks separately.
      body.push(
        renderInput(node, fieldId(node, "onSubmit", "input", context, true)),
      );
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

/**
 * A `<Button>` → a top-level action, or `undefined` when it can route nowhere.
 *
 * A `<Button>` with neither a `url` nor an `onClick` has no destination, and
 * there is no inert button in Adaptive Cards: emitted as an `Action.Submit` it
 * would still submit the card, and Teams delivers that as an ordinary Message
 * activity with empty `text`, which `parseCardAction` rejects (no `ckActionId`)
 * and the adapter then drives as a blank user turn. Worse, Teams merges every
 * card input into whichever submit fires, so the click also swallows what the
 * user typed. Emitting nothing is the only shape that cannot do either.
 */
function renderButton(node: ChannelNode): CardAction | undefined {
  const props = node.props ?? {};
  // Link button → Action.OpenUrl (opens the URL; carries no submit data).
  if (typeof props.url === "string" && props.url.length > 0) {
    return {
      type: "Action.OpenUrl",
      title: truncateText(collectText(node), TEAMS_LIMITS.buttonText),
      url: props.url,
    };
  }
  // The opaque action id is what routes the submit back into the engine, so a
  // button without one is dropped. `value` alone is not a route: the decode
  // keys on `ckActionId`.
  const id = idFromHandler(props.onClick);
  if (!id) return undefined;
  const action: CardAction = {
    type: "Action.Submit",
    title: truncateText(collectText(node), TEAMS_LIMITS.buttonText),
    data: {
      ckActionId: id,
      ...(props.value !== undefined ? { value: props.value } : {}),
    },
  };
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
  /** Can this field produce a value? Only then may it back a synthesized submit. */
  canProduceValue: boolean,
): string {
  const props = node.props ?? {};
  const index = ++context.nextFieldIndex;
  const rawName = typeof props.name === "string" ? props.name.trim() : "";
  const explicitName =
    rawName && !CARD_ENVELOPE_KEYS.includes(rawName) ? rawName : undefined;
  const actionId = idFromHandler(props[handlerProp]);
  const base = explicitName ?? actionId ?? `${fallback}_${index}`;
  let candidate = base;
  let suffix = 1;
  while (context.usedFieldIds.has(candidate)) {
    candidate = `${base}_${suffix++}`;
  }
  context.usedFieldIds.add(candidate);
  // An explicit `name` (or a dedupe suffix) makes the field id diverge from the
  // minted action id, so record both: dispatch needs the action id, reading the
  // submitted text needs the field id.
  if (actionId && canProduceValue) {
    context.boundFields.push({ fieldId: candidate, actionId });
  }
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

  const headerColumns = columns && columns.length > 0 ? columns : undefined;
  const rows: Record<string, unknown>[] = [];
  if (headerColumns) {
    rows.push({
      type: "TableRow",
      cells: headerColumns.map((c) => cell(c.header, true)),
    });
  }
  const rowNodes = childNodes(node).filter((c) => c.type === "row");
  // The header is one of the emitted rows, so it takes a slot from the same
  // budget rather than riding on top of a full set of data rows.
  const { items: dataRows } = clampArray(
    rowNodes,
    TEAMS_LIMITS.tableRows - (headerColumns ? 1 : 0),
  );
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
    firstRowAsHeader: !!headerColumns,
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

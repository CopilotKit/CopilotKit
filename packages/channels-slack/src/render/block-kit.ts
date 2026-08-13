import { isNativeNode } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import type { ContextActionsBlock, KnownBlock } from "@slack/types";
import { markdownToMrkdwn } from "../markdown-to-mrkdwn.js";
import { SLACK_LIMITS, clampArray, truncateText } from "./budget.js";
import { serializeSlackNativeNode } from "../native-codec.js";
import { validateSlackBlockKit } from "../block-kit-validation.js";

/**
 * Stable `action_id` of the native AI feedback row's `feedback_buttons`
 * element. The adapter intercepts clicks on this id (routing them to the
 * app's feedback callback) before they reach the engine's interaction
 * dispatch — see `adapter.ts`.
 */
export const FEEDBACK_ACTION_ID = "ck-fb";

/**
 * Build the native AI-feedback row (`context_actions` + `feedback_buttons`)
 * attached to a finalized streamed reply via `chat.stopStream`'s `blocks`.
 * The clicked button's `value` ("positive" / "negative") carries the sentiment.
 */
export function buildFeedbackBlocks(opts?: {
  positiveLabel?: string;
  negativeLabel?: string;
}): KnownBlock[] {
  const block: ContextActionsBlock = {
    type: "context_actions",
    elements: [
      {
        type: "feedback_buttons",
        action_id: FEEDBACK_ACTION_ID,
        positive_button: {
          text: {
            type: "plain_text",
            text: truncateText(
              opts?.positiveLabel ?? "Good response",
              SLACK_LIMITS.buttonText,
            ),
          },
          value: "positive",
        },
        negative_button: {
          text: {
            type: "plain_text",
            text: truncateText(
              opts?.negativeLabel ?? "Bad response",
              SLACK_LIMITS.buttonText,
            ),
          },
          value: "negative",
        },
      },
    ],
  };
  return [block];
}

/**
 * Render a cross-platform component IR tree (already expanded by `renderToIR`
 * and pre-bound by the action registry, so event props are `{ id }`) into a
 * Slack Block Kit `KnownBlock[]`.
 *
 * The renderer is total: unknown intrinsic types are skipped rather than
 * throwing. Per-element Slack limits are applied via {@link truncateText} and
 * {@link clampArray}; nothing is silently dropped — overflowing collections
 * clamp and, at the top level, append an explicit overflow signal block.
 */
export function renderBlockKit(ir: ChannelNode[]): KnownBlock[] {
  return renderBlockKitWithOverflow(ir, "clamp");
}

function renderBlockKitWithOverflow(
  ir: ChannelNode[],
  overflowMode: "clamp" | "error",
): KnownBlock[] {
  if (overflowMode === "error") assertSlackComponentProvider(ir);
  const blocks: KnownBlock[] = [];
  const native = containsNativeNode(ir);
  for (const node of ir) {
    renderNode(node, blocks);
  }

  const dataVisualizations = blocks.filter(
    (block) => String(block.type) === "data_visualization",
  ).length;
  if (dataVisualizations > 2) {
    throw new Error(
      `Slack native JSX rendered ${dataVisualizations} data visualization blocks; the message limit is 2.`,
    );
  }

  if (
    overflowMode === "error" &&
    blocks.length > SLACK_LIMITS.blocksPerMessage
  ) {
    throw new Error(
      `Slack Channel component rendered ${blocks.length} blocks; the message limit is ${SLACK_LIMITS.blocksPerMessage}.`,
    );
  }

  if (native && blocks.length > SLACK_LIMITS.blocksPerMessage) {
    throw new Error(
      `Slack native JSX rendered ${blocks.length} blocks; the message limit is ${SLACK_LIMITS.blocksPerMessage}.`,
    );
  }

  validateSlackBlockKit(blocks);

  // Top-level budget: clamp to the per-message block ceiling, leaving room for
  // an overflow-signal context block when we had to drop anything.
  const { items, overflow } = clampArray(blocks, SLACK_LIMITS.blocksPerMessage);
  if (overflow <= 0) return items;

  // Drop the last kept block to make room for the signal so we land at exactly
  // the ceiling (49 kept + 1 signal = 50) instead of exceeding it.
  const kept = items.slice(0, SLACK_LIMITS.blocksPerMessage - 1);
  const dropped = overflow + 1;
  kept.push(overflowSignal(dropped));
  return kept;
}

function assertSlackComponentProvider(nodes: readonly ChannelNode[]): void {
  for (const node of nodes) {
    if (isNativeNode(node) && node.props.provider !== "slack") {
      throw new Error("Slack delivery cannot render Teams native JSX.");
    }
    assertSlackPortableNodeBudget(node);
    assertSlackComponentProvider(channelChildren(node.props.children));
  }
}

function assertSlackPortableNodeBudget(node: ChannelNode): void {
  if (typeof node.type !== "string" || isNativeNode(node)) return;
  const children = childNodes(node);
  const text = collectText(node);
  if (node.type === "header" && text.length > SLACK_LIMITS.headerText) {
    failSlackComponentText("header text", text.length, SLACK_LIMITS.headerText);
  }
  if (
    (node.type === "section" || node.type === "markdown") &&
    markdownToMrkdwn(text).length > SLACK_LIMITS.sectionText
  ) {
    failSlackComponentText(
      "section text",
      markdownToMrkdwn(text).length,
      SLACK_LIMITS.sectionText,
    );
  }
  if (
    node.type === "text" &&
    String(node.props.value ?? "").length > SLACK_LIMITS.sectionText
  ) {
    failSlackComponentText(
      "section text",
      String(node.props.value ?? "").length,
      SLACK_LIMITS.sectionText,
    );
  }
  if (node.type === "field") {
    assertSlackTextBudget(
      "field text",
      fieldMrkdwn(node),
      SLACK_LIMITS.fieldText,
    );
  }
  assertSlackCollectionBudget(
    node.type,
    "fields",
    children.filter((child) => child.type === "field").length,
    SLACK_LIMITS.fieldsPerSection,
  );
  assertSlackCollectionBudget(
    node.type,
    "context elements",
    children.length,
    SLACK_LIMITS.contextElements,
    "context",
  );
  assertSlackCollectionBudget(
    node.type,
    "action elements",
    children.length,
    SLACK_LIMITS.actionsElements,
    "actions",
  );
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
    if (Math.max(columns, inferredColumns) > SLACK_LIMITS.tableColumns) {
      throw new Error(
        `Slack Channel component table has ${Math.max(columns, inferredColumns)} columns; the limit is ${SLACK_LIMITS.tableColumns}.`,
      );
    }
    if (rows > SLACK_LIMITS.tableRows) {
      throw new Error(
        `Slack Channel component table has ${rows} rows; the limit is ${SLACK_LIMITS.tableRows}.`,
      );
    }
    for (const column of Array.isArray(node.props.columns)
      ? (node.props.columns as Array<{ header?: unknown }>)
      : []) {
      assertSlackTextBudget(
        "table cell text",
        String(column.header ?? ""),
        SLACK_LIMITS.cellText,
      );
    }
    for (const row of rowNodes) {
      for (const cell of childNodes(row).filter(
        (child) => child.type === "cell",
      )) {
        assertSlackTextBudget(
          "table cell text",
          collectText(cell),
          SLACK_LIMITS.cellText,
        );
      }
    }
  }
  if (node.type === "select") {
    assertSlackActionIdBudget(node.props.onSelect, "select");
    assertSlackTextBudget(
      "select placeholder",
      String(node.props.placeholder ?? " "),
      SLACK_LIMITS.selectPlaceholder,
    );
    const options = Array.isArray(node.props.options) ? node.props.options : [];
    const count = options.length;
    if (count > SLACK_LIMITS.selectOptions) {
      throw new Error(
        `Slack Channel component select has ${count} options; the limit is ${SLACK_LIMITS.selectOptions}.`,
      );
    }
    for (const option of options as Array<{
      label?: unknown;
      value?: unknown;
    }>) {
      assertSlackTextBudget(
        "select option label",
        String(option.label ?? ""),
        SLACK_LIMITS.selectOptionText,
      );
      assertSlackTextBudget(
        "select option value",
        String(option.value ?? ""),
        SLACK_LIMITS.selectOptionValue,
      );
    }
  }
  if (node.type === "button") {
    assertSlackTextBudget(
      "button text",
      collectText(node),
      SLACK_LIMITS.buttonText,
    );
    const actionId = buttonActionId(node.props);
    assertSlackTextBudget("action id", actionId, SLACK_LIMITS.actionId);
    if (node.props.value !== undefined) {
      assertSlackTextBudget(
        "button value",
        JSON.stringify(node.props.value),
        SLACK_LIMITS.buttonValue,
      );
    }
  }
  if (node.type === "input") {
    assertSlackActionIdBudget(node.props.onSubmit, "input");
    assertSlackTextBudget(
      "input label",
      String(node.props.placeholder ?? " "),
      SLACK_LIMITS.inputLabel,
    );
  }
}

function assertSlackActionIdBudget(value: unknown, fallback: string): void {
  assertSlackTextBudget(
    "action id",
    idFromHandler(value) ?? fallback,
    SLACK_LIMITS.actionId,
  );
}

function assertSlackTextBudget(
  kind: string,
  text: string,
  limit: number,
): void {
  if (text.length > limit) failSlackComponentText(kind, text.length, limit);
}

function failSlackComponentText(
  kind: string,
  length: number,
  limit: number,
): never {
  throw new Error(
    `Slack Channel component ${kind} has ${length} characters; the limit is ${limit}.`,
  );
}

function assertSlackCollectionBudget(
  nodeType: string,
  label: string,
  count: number,
  limit: number,
  expectedType = label,
): void {
  if (nodeType === expectedType && count > limit) {
    throw new Error(
      `Slack Channel component ${label} has ${count} items; the limit is ${limit}.`,
    );
  }
}

function containsNativeNode(nodes: readonly ChannelNode[]): boolean {
  return nodes.some(
    (node) =>
      isNativeNode(node) ||
      containsNativeNode(channelChildren(node.props.children)),
  );
}

function channelChildren(value: unknown): ChannelNode[] {
  if (Array.isArray(value)) return value.filter(isChannelNode);
  return isChannelNode(value) ? [value] : [];
}

function isChannelNode(value: unknown): value is ChannelNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "props" in value
  );
}

/** Render IR to Slack blocks, extracting a top-level <Message accent="#hex"> color for an attachment wrapper. */
export function renderSlackMessage(ir: ChannelNode[]): {
  blocks: KnownBlock[];
  accent?: string;
} {
  const blocks = renderBlockKit(ir);
  // Top-level single <Message accent="..."> → use its accent as the attachment color.
  if (ir.length === 1 && ir[0] && ir[0].type === "message") {
    const accent = (ir[0].props as { accent?: unknown }).accent;
    if (typeof accent === "string" && accent.length > 0)
      return { blocks, accent };
  }
  return { blocks };
}

/** Render one Channel component revision for Slack provider delivery. */
export function renderSlackComponentMessage(ir: ChannelNode[]): {
  blocks: KnownBlock[];
  accent?: string;
} {
  const blocks = renderBlockKitWithOverflow(ir, "error");
  assertSlackRenderedComponentBudget(blocks);
  if (ir.length === 1 && ir[0] && ir[0].type === "message") {
    const accent = (ir[0].props as { accent?: unknown }).accent;
    if (typeof accent === "string" && accent.length > 0) {
      return { blocks, accent };
    }
  }
  return { blocks };
}

function assertSlackRenderedComponentBudget(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) assertSlackRenderedComponentBudget(child);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  const text =
    typeof record.text === "object" && record.text !== null
      ? (record.text as { text?: unknown }).text
      : undefined;
  if (
    record.type === "section" &&
    typeof text === "string" &&
    text.length > SLACK_LIMITS.sectionText
  ) {
    throw new Error(
      `Slack Channel component section text has ${text.length} characters; the limit is ${SLACK_LIMITS.sectionText}.`,
    );
  }
  if (record.type === "section" && Array.isArray(record.fields)) {
    assertSlackCollectionBudget(
      "fields",
      "fields",
      record.fields.length,
      SLACK_LIMITS.fieldsPerSection,
    );
    for (const field of record.fields) {
      if (typeof field !== "object" || field === null) continue;
      assertSlackTextBudget(
        "field text",
        String((field as Record<string, unknown>).text ?? ""),
        SLACK_LIMITS.fieldText,
      );
    }
  }
  if (record.type === "actions" && Array.isArray(record.elements)) {
    assertSlackCollectionBudget(
      "actions",
      "action elements",
      record.elements.length,
      SLACK_LIMITS.actionsElements,
      "actions",
    );
  }
  if (
    (record.type === "context" || record.type === "context_actions") &&
    Array.isArray(record.elements)
  ) {
    if (record.elements.length > SLACK_LIMITS.contextElements) {
      throw new Error(
        `Slack Channel component context elements has ${record.elements.length} items; the limit is ${SLACK_LIMITS.contextElements}.`,
      );
    }
  }
  if (typeof record.action_id === "string") {
    assertSlackTextBudget("action id", record.action_id, SLACK_LIMITS.actionId);
  }
  if (record.type === "button") {
    const buttonText =
      typeof record.text === "object" && record.text !== null
        ? String((record.text as Record<string, unknown>).text ?? "")
        : "";
    assertSlackTextBudget("button text", buttonText, SLACK_LIMITS.buttonText);
    if (typeof record.value === "string") {
      assertSlackTextBudget(
        "button value",
        record.value,
        SLACK_LIMITS.buttonValue,
      );
    }
  }
  if (record.type === "feedback_buttons") {
    for (const key of ["positive_button", "negative_button"] as const) {
      const button = record[key];
      if (typeof button !== "object" || button === null) continue;
      const nested = button as Record<string, unknown>;
      const nestedText =
        typeof nested.text === "object" && nested.text !== null
          ? String((nested.text as Record<string, unknown>).text ?? "")
          : "";
      assertSlackTextBudget("button text", nestedText, SLACK_LIMITS.buttonText);
      if (typeof nested.value === "string") {
        assertSlackTextBudget(
          "button value",
          nested.value,
          SLACK_LIMITS.buttonValue,
        );
      }
    }
  }
  if (
    (record.type === "static_select" ||
      record.type === "multi_static_select") &&
    Array.isArray(record.options)
  ) {
    if (record.options.length > SLACK_LIMITS.selectOptions) {
      throw new Error(
        `Slack Channel component select has ${record.options.length} options; the limit is ${SLACK_LIMITS.selectOptions}.`,
      );
    }
  }
  if (
    "placeholder" in record &&
    typeof record.placeholder === "object" &&
    record.placeholder !== null
  ) {
    assertSlackTextBudget(
      "select placeholder",
      String((record.placeholder as Record<string, unknown>).text ?? ""),
      SLACK_LIMITS.selectPlaceholder,
    );
  }
  if (Array.isArray(record.options)) {
    for (const option of record.options) assertSlackOptionBudget(option);
  }
  if (Array.isArray(record.option_groups)) {
    for (const group of record.option_groups) {
      if (typeof group !== "object" || group === null) continue;
      const options = (group as Record<string, unknown>).options;
      if (!Array.isArray(options)) continue;
      for (const option of options) assertSlackOptionBudget(option);
    }
  }
  if (
    record.type === "input" &&
    typeof record.label === "object" &&
    record.label !== null
  ) {
    assertSlackTextBudget(
      "input label",
      String((record.label as Record<string, unknown>).text ?? ""),
      SLACK_LIMITS.inputLabel,
    );
  }
  if (record.type === "table" && Array.isArray(record.rows)) {
    if (record.rows.length > SLACK_LIMITS.tableRows) {
      throw new Error(
        `Slack Channel component table has ${record.rows.length} rows; the limit is ${SLACK_LIMITS.tableRows}.`,
      );
    }
    for (const row of record.rows) {
      if (!Array.isArray(row)) continue;
      if (row.length > SLACK_LIMITS.tableColumns) {
        throw new Error(
          `Slack Channel component table has ${row.length} columns; the limit is ${SLACK_LIMITS.tableColumns}.`,
        );
      }
      for (const cell of row) {
        if (typeof cell !== "object" || cell === null) continue;
        assertSlackTextBudget(
          "table cell text",
          String((cell as Record<string, unknown>).text ?? ""),
          SLACK_LIMITS.cellText,
        );
      }
    }
  }
  if (
    record.type === "header" &&
    typeof text === "string" &&
    text.length > SLACK_LIMITS.headerText
  ) {
    throw new Error(
      `Slack Channel component header text has ${text.length} characters; the limit is ${SLACK_LIMITS.headerText}.`,
    );
  }
  for (const child of Object.values(record)) {
    assertSlackRenderedComponentBudget(child);
  }
}

function assertSlackOptionBudget(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  const option = value as Record<string, unknown>;
  const text =
    typeof option.text === "object" && option.text !== null
      ? String((option.text as Record<string, unknown>).text ?? "")
      : "";
  assertSlackTextBudget(
    "select option label",
    text,
    SLACK_LIMITS.selectOptionText,
  );
  assertSlackTextBudget(
    "select option value",
    String(option.value ?? ""),
    SLACK_LIMITS.selectOptionValue,
  );
}

function overflowSignal(count: number): KnownBlock {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text: `_…+${count} more blocks truncated_` }],
  } as KnownBlock;
}

/** Render a single IR node, pushing zero or more blocks onto `out`. */
function renderNode(node: ChannelNode, out: KnownBlock[]): void {
  if (isNativeNode(node)) {
    if (node.props.nativeKind !== "block" && node.props.nativeKind !== "raw") {
      throw new Error(
        `Slack.${node.props.nativeType}: a top-level message child must be a block.`,
      );
    }
    out.push(serializeSlackNativeNode(node) as unknown as KnownBlock);
    return;
  }
  if (typeof node.type !== "string") return; // non-intrinsic — already expanded away
  const props = node.props ?? {};
  switch (node.type) {
    case "message": {
      // The message container is not a block; flatten its children.
      for (const child of childNodes(node)) renderNode(child, out);
      return;
    }
    case "header": {
      out.push({
        type: "header",
        text: {
          type: "plain_text",
          text: truncateText(collectText(node), SLACK_LIMITS.headerText),
        },
      } as KnownBlock);
      return;
    }
    case "section":
    case "markdown": {
      out.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: truncateText(
            markdownToMrkdwn(collectText(node)),
            SLACK_LIMITS.sectionText,
          ),
        },
      } as KnownBlock);
      return;
    }
    case "fields": {
      const fieldChildren = childNodes(node).filter((c) => c.type === "field");
      const { items } = clampArray(
        fieldChildren,
        SLACK_LIMITS.fieldsPerSection,
      );
      out.push({
        type: "section",
        fields: items.map((f) => ({
          type: "mrkdwn",
          text: truncateText(fieldMrkdwn(f), SLACK_LIMITS.fieldText),
        })),
      } as KnownBlock);
      return;
    }
    case "field": {
      // Standalone field (rare) → single-field section.
      out.push({
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: truncateText(fieldMrkdwn(node), SLACK_LIMITS.fieldText),
          },
        ],
      } as KnownBlock);
      return;
    }
    case "context": {
      const { items } = clampArray(
        childNodes(node),
        SLACK_LIMITS.contextElements,
      );
      out.push({
        type: "context",
        elements: items.map((c) => ({
          type: "mrkdwn",
          text: markdownToMrkdwn(collectText(c)),
        })),
      } as KnownBlock);
      return;
    }
    case "actions": {
      const { items } = clampArray(
        childNodes(node),
        SLACK_LIMITS.actionsElements,
      );
      // A multi-select can't live in an `actions` block (Slack allows
      // multi_static_select only in section/input blocks), so peel each one off
      // into its own dispatching input block; the rest stay as action elements.
      // Flush the pending actions block BEFORE each peeled-off input so blocks
      // stay in source order (e.g. [Button, Select multi] → actions, then input).
      let elements: object[] = [];
      const flush = () => {
        if (elements.length > 0) {
          out.push({ type: "actions", elements } as KnownBlock);
          elements = [];
        }
      };
      for (const child of items) {
        if (child.type === "select" && child.props.multi) {
          flush();
          out.push(multiSelectInput(child));
          continue;
        }
        const el = renderActionElement(child);
        if (el !== null) elements.push(el);
      }
      flush();
      return;
    }
    case "image": {
      const url = (props.url ?? props.image_url) as string | undefined;
      out.push({
        type: "image",
        image_url: url ?? "",
        alt_text: (props.alt ?? props.altText ?? "") as string,
      } as KnownBlock);
      return;
    }
    case "divider": {
      out.push({ type: "divider" } as KnownBlock);
      return;
    }
    case "input": {
      out.push({
        type: "input",
        dispatch_action: true,
        element: {
          type: "plain_text_input",
          action_id: truncateText(
            idFromHandler(props.onSubmit) ?? "input",
            SLACK_LIMITS.actionId,
          ),
          multiline: !!props.multiline,
        },
        label: {
          type: "plain_text",
          text: truncateText(
            String(props.placeholder ?? " "),
            SLACK_LIMITS.inputLabel,
          ),
        },
      } as KnownBlock);
      return;
    }
    case "text": {
      // Bare top-level text → a mrkdwn section.
      const value = String(props.value ?? "");
      out.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: truncateText(markdownToMrkdwn(value), SLACK_LIMITS.sectionText),
        },
      } as KnownBlock);
      return;
    }
    case "table": {
      // Native Slack Table block: rows of `{ type: "raw_text", text }` cells.
      // Header row from `columns`, data rows from `row`/`cell` children.
      // Not yet in `@slack/types`, so the block is built plain and cast.
      const cellOf = (text: string): { type: "raw_text"; text: string } => ({
        type: "raw_text",
        text: truncateText(text, SLACK_LIMITS.cellText),
      });

      const columnsProp = props.columns as
        | { header: string; align?: "left" | "center" | "right" }[]
        | undefined;
      const columns = columnsProp
        ? clampArray(columnsProp, SLACK_LIMITS.tableColumns).items
        : undefined;

      const rows: { type: "raw_text"; text: string }[][] = [];
      if (columns && columns.length > 0) {
        rows.push(columns.map((c) => cellOf(c.header)));
      }

      const rowNodes = childNodes(node).filter((c) => c.type === "row");
      const { items: dataRows } = clampArray(rowNodes, SLACK_LIMITS.tableRows);
      for (const rowNode of dataRows) {
        const cells = childNodes(rowNode).filter((c) => c.type === "cell");
        rows.push(cells.map((cell) => cellOf(collectText(cell))));
      }

      const block: Record<string, unknown> = { type: "table", rows };
      if (columns) {
        block.column_settings = columns.map((c) => ({
          align: c.align ?? "left",
        }));
      }
      out.push(block as unknown as KnownBlock);
      return;
    }
    case "raw": {
      const value = props.value;
      const native = Array.isArray(value) ? value : [value];
      for (const b of native) {
        if (b != null) out.push(b as KnownBlock);
      }
      return;
    }
    default:
      // Unknown intrinsic — skip silently (total renderer).
      return;
  }
}

/**
 * Render one interactive element inside an `actions` block. Returns `null` for
 * children that aren't renderable as action elements (so callers can filter).
 */
function renderActionElement(node: ChannelNode): object | null {
  if (typeof node.type !== "string") return null;
  const props = node.props ?? {};
  switch (node.type) {
    case "button": {
      const action_id = truncateText(
        buttonActionId(props),
        SLACK_LIMITS.actionId,
      );
      const el: Record<string, unknown> = {
        type: "button",
        action_id,
        text: {
          type: "plain_text",
          text: truncateText(collectText(node), SLACK_LIMITS.buttonText),
        },
      };
      // Link button: opens the URL natively. Slack still requires an action_id
      // (kept above); clicks on a url button are not dispatched as actions.
      if (typeof props.url === "string" && props.url.length > 0) {
        el.url = props.url;
      }
      if (props.value !== undefined) {
        el.value = truncateText(
          JSON.stringify(props.value),
          SLACK_LIMITS.buttonValue,
        );
      }
      if (props.style === "primary" || props.style === "danger") {
        el.style = props.style;
      }
      return el;
    }
    case "select": {
      const action_id = truncateText(
        idFromHandler(props.onSelect) ?? "select",
        SLACK_LIMITS.actionId,
      );
      const options =
        (props.options as { label: string; value: unknown }[] | undefined) ??
        [];
      const { items } = clampArray(options, SLACK_LIMITS.selectOptions);
      const el: Record<string, unknown> = {
        type: "static_select",
        action_id,
        placeholder: {
          type: "plain_text",
          text: truncateText(
            String(props.placeholder ?? " "),
            SLACK_LIMITS.selectPlaceholder,
          ),
        },
        options: items.map((o) => ({
          text: {
            type: "plain_text",
            text: truncateText(o.label, SLACK_LIMITS.selectOptionText),
          },
          value: truncateText(String(o.value), SLACK_LIMITS.selectOptionValue),
        })),
      };
      return el;
    }
    default:
      return null;
  }
}

/**
 * Render a `<Select multi>` as a dispatching input block holding a
 * `multi_static_select` (which Slack forbids inside an `actions` block). The
 * block_actions payload carries `selected_options`, decoded to a `string[]`.
 */
function multiSelectInput(node: ChannelNode): KnownBlock {
  const props = node.props ?? {};
  const action_id = truncateText(
    idFromHandler(props.onSelect) ?? "select",
    SLACK_LIMITS.actionId,
  );
  const options =
    (props.options as { label: string; value: unknown }[] | undefined) ?? [];
  const { items } = clampArray(options, SLACK_LIMITS.selectOptions);
  return {
    type: "input",
    dispatch_action: true,
    element: {
      type: "multi_static_select",
      action_id,
      placeholder: {
        type: "plain_text",
        text: truncateText(
          String(props.placeholder ?? " "),
          SLACK_LIMITS.selectPlaceholder,
        ),
      },
      options: items.map((o) => ({
        text: {
          type: "plain_text",
          text: truncateText(o.label, SLACK_LIMITS.selectOptionText),
        },
        value: truncateText(String(o.value), SLACK_LIMITS.selectOptionValue),
      })),
    },
    label: {
      type: "plain_text",
      text: truncateText(
        String(props.placeholder ?? " "),
        SLACK_LIMITS.inputLabel,
      ),
    },
  } as KnownBlock;
}

/** Derive a button's `action_id`: prefer the registry-stamped id, else a stable fallback. */
function buttonActionId(props: Record<string, unknown>): string {
  const fromHandler = idFromHandler(props.onClick);
  if (fromHandler) return fromHandler;
  return props.value !== undefined ? JSON.stringify(props.value) : "action";
}

/** Extract `{ id }` stamped onto an event prop by the action registry, if present. */
function idFromHandler(handler: unknown): string | undefined {
  if (handler && typeof handler === "object" && "id" in handler) {
    const id = (handler as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

/** The expanded `children` of an IR node as an `ChannelNode[]` (empty if none). */
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

/** A field's mrkdwn text: a bold `label` line (when set) above the value. */
function fieldMrkdwn(node: ChannelNode): string {
  const value = markdownToMrkdwn(collectText(node));
  const label = (node.props as { label?: unknown }).label;
  return typeof label === "string" && label.length > 0
    ? `*${label}*\n${value}`
    : value;
}

/** Concatenate the `value` of all descendant `text` nodes (depth-first). */
function collectText(node: ChannelNode): string {
  if (typeof node.type === "string" && node.type === "text") {
    return String(node.props?.value ?? "");
  }
  let acc = "";
  for (const child of childNodes(node)) {
    acc += collectText(child);
  }
  return acc;
}

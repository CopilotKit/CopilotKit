import type { ChannelNode } from "@copilotkit/channels-ui";
import type { ContextActionsBlock, KnownBlock } from "@slack/types";
import { markdownToMrkdwn } from "../markdown-to-mrkdwn.js";
import { SLACK_LIMITS, clampArray, truncateText } from "./budget.js";

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
  const blocks: KnownBlock[] = [];
  for (const node of ir) {
    renderNode(node, blocks);
  }

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

function overflowSignal(count: number): KnownBlock {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text: `_…+${count} more blocks truncated_` }],
  } as KnownBlock;
}

/** Render a single IR node, pushing zero or more blocks onto `out`. */
function renderNode(node: ChannelNode, out: KnownBlock[]): void {
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
          text: truncateText(String(props.placeholder ?? " "), 150),
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
          text: String(props.placeholder ?? " "),
        },
        options: items.map((o) => ({
          text: { type: "plain_text", text: truncateText(o.label, 75) },
          value: truncateText(String(o.value), 150),
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
        text: String(props.placeholder ?? " "),
      },
      options: items.map((o) => ({
        text: { type: "plain_text", text: truncateText(o.label, 75) },
        value: truncateText(String(o.value), 150),
      })),
    },
    label: {
      type: "plain_text",
      text: truncateText(String(props.placeholder ?? " "), 150),
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

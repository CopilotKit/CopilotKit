import type { ChannelNode } from "@copilotkit/channels-ui";
import type { ContextActionsBlock, KnownBlock } from "@slack/types";
import { FIELD_BLOCK_PREFIX } from "../interaction.js";
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
  const context: RenderContext = { nextFieldIndex: 0, usedFieldIds: new Set() };
  for (const node of ir) {
    renderNode(node, blocks, context);
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

/** Per-message state for minting field ids — see {@link fieldId}. */
interface RenderContext {
  nextFieldIndex: number;
  usedFieldIds: Set<string>;
}

function overflowSignal(count: number): KnownBlock {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text: `_…+${count} more blocks truncated_` }],
  } as KnownBlock;
}

/** Render a single IR node, pushing zero or more blocks onto `out`. */
function renderNode(
  node: ChannelNode,
  out: KnownBlock[],
  context: RenderContext,
): void {
  if (typeof node.type !== "string") return; // non-intrinsic — already expanded away
  const props = node.props ?? {};
  switch (node.type) {
    case "message": {
      // The message container is not a block; flatten its children.
      for (const child of childNodes(node)) renderNode(child, out, context);
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
      // Every field is peeled into a block of its own, leaving `actions` blocks
      // to the buttons. Two reasons, and both apply to all three field shapes:
      // Slack forbids a text input and a multi-select inside an `actions` block
      // at all (they belong in input blocks), and a field's `values` key rides
      // on its block id (see `fieldBlockId`), which one shared block could only
      // spell for one of them. Teams' `actions` case simply recurses, so peeling
      // — rather than dropping — is what keeps identical JSX rendering the same
      // on both MVP surfaces. Flush the pending actions block BEFORE each peeled
      // field so blocks stay in source order (e.g. [Button, Select multi] →
      // actions, then input).
      let elements: object[] = [];
      const flush = () => {
        if (elements.length > 0) {
          // `actionsElements` bounds one emitted `actions` block, so clamp
          // here rather than over the children: peeled-off inputs and
          // unrenderable children never take a slot in any block, and a peel
          // splits the rest across several blocks that are budgeted apart.
          const { items } = clampArray(elements, SLACK_LIMITS.actionsElements);
          out.push({ type: "actions", elements: items } as KnownBlock);
          elements = [];
        }
      };
      for (const child of childNodes(node)) {
        if (child.type === "input") {
          flush();
          out.push(textInput(child, context));
          continue;
        }
        if (child.type === "select") {
          flush();
          out.push(selectBlock(child, context));
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
      out.push(textInput(node, context));
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
      // The header is a row of the emitted block too, so budget data rows
      // against what it leaves of the table's row ceiling.
      const { items: dataRows } = clampArray(
        rowNodes,
        SLACK_LIMITS.tableRows - rows.length,
      );
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
 * Render one interactive element inside a shared `actions` block. Only a
 * `<Button>` qualifies — every field is peeled into a block of its own by the
 * caller. Returns `null` for children that aren't renderable as action elements
 * (so callers can filter).
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
    default:
      return null;
  }
}

/**
 * Render an `<Input>` as a dispatching input block holding a
 * `plain_text_input` (which Slack forbids inside an `actions` block). Typing
 * and submitting fires a `block_actions` payload carrying the typed text
 * verbatim on the element's `action_id` — the registry-minted `onSubmit` id.
 *
 * `dispatch_action` on the block only permits that payload; WHEN it fires is
 * the element's `dispatch_action_config` — a `plain_text_input`'s dispatch is
 * "determined by the dispatch_action_config field" (Slack's `block_actions`
 * reference), whose only two triggers are `on_enter_pressed` and
 * `on_character_entered`. We name `on_enter_pressed` rather than lean on
 * Slack's unspecified default: Enter-to-submit is the affordance `onSubmit`
 * means, and naming it is what makes the multiline case below decidable.
 *
 * `multiline` is a presentation hint and `onSubmit` is a data contract, and on
 * Slack a `plain_text_input` cannot honour both: a BOUND multiline input is
 * therefore rendered single-line, so Enter submits it. Neither trigger works in
 * a tall box —
 *   - `on_enter_pressed` never fires, because Enter inserts a newline there.
 *     That is the shape this replaces: the handler never ran, and a
 *     `thread.awaitChoice` waiting on it hung forever.
 *   - `on_character_entered` fires once per KEYSTROKE, so it would run
 *     `onSubmit` on every prefix of the text and resolve an `awaitChoice` on
 *     the first character. `onSubmit` is a `ClickHandler<string>` whose value
 *     is the submitted text, not a fragment of it — a wrong value delivered
 *     N times is worse than the hang it replaces.
 * Slack also has no per-input submit button, and a synthesized one could not
 * carry the text: only a static `value` rides on a `block_actions` action, so
 * such a click would reach `onSubmit` (and any `awaitChoice`) as `undefined`
 * while the text arrived separately in `state.values`. A one-line box that
 * submits the whole string beats a taller box that submits nothing, a
 * fragment, or nothing but a hole where the string should be.
 *
 * An UNBOUND `<Input multiline>` keeps its tall box: with no `onSubmit` there
 * is nothing to make unreachable — its text rides to a sibling `<Button>`'s
 * click in `state.values`, keyed by {@link fieldBlockId} — and it claims no
 * trigger, since the one it could claim could not fire.
 */
function textInput(node: ChannelNode, context: RenderContext): KnownBlock {
  const props = node.props ?? {};
  const id = fieldId(node, "onSubmit", "input", context);
  // Only a handler-bound input has a submit to keep reachable; `multiline`
  // costs an unbound one nothing, so it is honoured there.
  const bound = idFromHandler(props.onSubmit) !== undefined;
  const multiline = !!props.multiline && !bound;
  return {
    type: "input",
    block_id: fieldBlockId(id),
    dispatch_action: true,
    element: {
      type: "plain_text_input",
      action_id: elementActionId(props.onSubmit, id),
      multiline,
      // Claimed only where it can fire — see the multiline discussion above.
      // Slack renders its own "press enter to submit" hint under a box
      // configured this way.
      ...(multiline
        ? {}
        : {
            dispatch_action_config: {
              trigger_actions_on: ["on_enter_pressed"],
            },
          }),
    },
    label: {
      type: "plain_text",
      text: truncateText(String(props.placeholder ?? " "), 150),
    },
  } as KnownBlock;
}

/**
 * Render a `<Select>` as a block of its own naming the field: an `input` block
 * when `multi` (Slack forbids a `multi_static_select` inside an `actions` block
 * and an input block is what dispatches it), else a single-element `actions`
 * block, which is how a `static_select` renders inline. Either way the payload
 * carries the chosen option value(s) — `selected_options` decodes to a
 * `string[]`.
 */
function selectBlock(node: ChannelNode, context: RenderContext): KnownBlock {
  const props = node.props ?? {};
  const id = fieldId(node, "onSelect", "select", context);
  const options =
    (props.options as { label: string; value: unknown }[] | undefined) ?? [];
  const { items } = clampArray(options, SLACK_LIMITS.selectOptions);
  const element = {
    type: props.multi ? "multi_static_select" : "static_select",
    action_id: elementActionId(props.onSelect, id),
    placeholder: {
      type: "plain_text",
      text: String(props.placeholder ?? " "),
    },
    // A plain string on the wire, never JSON: `SelectOption.value` is a
    // `string`, so `interaction.ts` reads it back verbatim. (A `<Button>`'s
    // value is the opposite — `JSON.stringify`d above, JSON-parsed on the way
    // in.) `String(...)` keeps that true for an untyped JS caller.
    options: items.map((o) => ({
      text: { type: "plain_text", text: truncateText(o.label, 75) },
      value: truncateText(String(o.value), 150),
    })),
  };
  if (!props.multi) {
    return {
      type: "actions",
      block_id: fieldBlockId(id),
      elements: [element],
    } as KnownBlock;
  }
  return {
    type: "input",
    block_id: fieldBlockId(id),
    dispatch_action: true,
    element,
    label: {
      type: "plain_text",
      text: truncateText(String(props.placeholder ?? " "), 150),
    },
  } as KnownBlock;
}

/**
 * The key this field's reading appears under in an interaction's `values`,
 * derived exactly as Teams derives the Adaptive Card element `id` that plays the
 * same role (`fieldId()` in channels-teams' `render/adaptive-card.ts`): an
 * explicit `name` wins, else the registry-minted handler id, else a positional
 * fallback numbered off a counter every field advances. Deduped with a numbered
 * suffix, because two fields keyed alike would overwrite one another's reading.
 */
function fieldId(
  node: ChannelNode,
  handlerProp: "onSubmit" | "onSelect",
  fallback: "input" | "select",
  context: RenderContext,
): string {
  const props = node.props ?? {};
  const index = ++context.nextFieldIndex;
  const name = typeof props.name === "string" ? props.name.trim() : "";
  const base =
    name || idFromHandler(props[handlerProp]) || `${fallback}_${index}`;
  let candidate = base;
  let suffix = 1;
  while (context.usedFieldIds.has(candidate)) {
    candidate = `${base}_${suffix++}`;
  }
  context.usedFieldIds.add(candidate);
  return candidate;
}

/**
 * The `block_id` naming the single field a block holds, so `decodeInteraction`
 * can key `values` by it. Slack caps a block id at the same 255 chars as an
 * action id; the decode reads the key straight back off the block id, so a
 * truncated one stays self-consistent.
 */
function fieldBlockId(id: string): string {
  return truncateText(FIELD_BLOCK_PREFIX + id, SLACK_LIMITS.actionId);
}

/**
 * A field element's `action_id`. The registry-minted handler id when there is
 * one — the engine dispatches on exactly that string, so honouring `name` must
 * not touch it — else the field id, which is unique where the old `"input"` /
 * `"select"` literals collided.
 */
function elementActionId(handler: unknown, id: string): string {
  return truncateText(idFromHandler(handler) ?? id, SLACK_LIMITS.actionId);
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

import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { BotNode } from "@copilotkit/bot-ui";
import { DISCORD_LIMITS, truncateText, truncateFenced, clampArray } from "./budget.js";
import { discordMarkdown } from "../markdown.js";

/**
 * Running totals enforced across a single message render. Discord rejects the
 * entire message if it exceeds `componentsPerMessage` total components or
 * `totalTextChars` summed text, so we stop adding once a budget is reached and
 * emit a single trailing overflow signal (clamp, never silent drop).
 */
interface RenderBudget {
  components: number; // components added so far (TextDisplay, Separator, ActionRow, MediaGallery, …)
  textChars: number; // summed TextDisplay content length so far
  overflowed: boolean; // a trailing overflow marker already appended
}

const OVERFLOW_TEXT = "_…content truncated_";

/** True once the message is full; callers must stop adding components. */
function budgetFull(budget: RenderBudget): boolean {
  // Leave room for one trailing overflow TextDisplay.
  return (
    budget.components >= DISCORD_LIMITS.componentsPerMessage - 1 ||
    budget.textChars >= DISCORD_LIMITS.totalTextChars
  );
}

/** Append a single trailing overflow marker (idempotent) when the budget is hit. */
function signalOverflow(budget: RenderBudget, container: ContainerBuilder): void {
  if (budget.overflowed) return;
  budget.overflowed = true;
  budget.components += 1;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(OVERFLOW_TEXT));
}

/** Add a TextDisplay, charging the text budget and clamping to remaining room. */
function addText(content: string, budget: RenderBudget, container: ContainerBuilder): void {
  const remaining = DISCORD_LIMITS.totalTextChars - budget.textChars;
  const clamped = content.length > remaining ? truncateText(content, Math.max(0, remaining)) : content;
  budget.textChars += clamped.length;
  budget.components += 1;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(clamped));
}

/**
 * Render a cross-platform IR tree (already expanded + action-bound, so event
 * props are `{ id }`) into a single top-level Components V2 `ContainerBuilder`.
 *
 * Total renderer: unknown intrinsics are skipped, never thrown. Per-element
 * limits apply via truncate/clamp; nothing is silently dropped.
 */
export function renderComponents(ir: BotNode[]): ContainerBuilder {
  const container = new ContainerBuilder();

  // <Message accent="#hex"> → container accent color.
  if (ir.length === 1 && ir[0]?.type === "message") {
    const accent = (ir[0].props as { accent?: unknown }).accent;
    const int = parseAccent(accent);
    if (int !== undefined) container.setAccentColor(int);
  }

  const budget: RenderBudget = { components: 0, textChars: 0, overflowed: false };
  for (const node of ir) addNode(node, container, budget);
  return container;
}

/** Ready-to-send payload for channel.send / message.edit. */
export function renderDiscordMessage(ir: BotNode[]): {
  components: ContainerBuilder[];
  flags: number;
} {
  return { components: [renderComponents(ir)], flags: MessageFlags.IsComponentsV2 };
}

function addNode(node: BotNode, container: ContainerBuilder, budget: RenderBudget): void {
  if (typeof node.type !== "string") return; // non-intrinsic — already expanded
  // <Message> is a structural wrapper; recurse into it without charging budget.
  if (node.type === "message") {
    for (const child of childNodes(node)) addNode(child, container, budget);
    return;
  }
  // Message-level budget reached — emit one overflow marker and stop adding.
  if (budgetFull(budget)) {
    signalOverflow(budget, container);
    return;
  }
  const props = node.props ?? {};
  switch (node.type) {
    case "header": {
      addText("# " + truncateText(collectText(node), DISCORD_LIMITS.headerText), budget, container);
      return;
    }
    case "section":
    case "markdown":
    case "text": {
      const raw = node.type === "text" ? String(props.value ?? "") : collectText(node);
      // Fence-safe: truncate the rendered (possibly fenced) markdown without
      // cutting a closing ``` open.
      addText(
        truncateFenced(discordMarkdown(raw), DISCORD_LIMITS.textDisplayChars),
        budget,
        container,
      );
      return;
    }
    case "fields": {
      // No native field grid in CV2 — render each field as a bold-label line.
      const fields = childNodes(node).filter((c) => c.type === "field");
      const lines = fields.map((f) => `**${collectFieldLabel(f)}** ${collectFieldValue(f)}`.trim());
      addText(
        truncateFenced(discordMarkdown(lines.join("\n")), DISCORD_LIMITS.textDisplayChars),
        budget,
        container,
      );
      return;
    }
    case "field": {
      addText(
        truncateFenced(discordMarkdown(collectText(node)), DISCORD_LIMITS.textDisplayChars),
        budget,
        container,
      );
      return;
    }
    case "context": {
      // Discord subtext: lines prefixed with `-# `.
      const parts = childNodes(node).map((c) => collectText(c)).filter(Boolean);
      const body = parts.map((p) => `-# ${p}`).join("\n");
      addText(truncateText(body, DISCORD_LIMITS.textDisplayChars), budget, container);
      return;
    }
    case "divider": {
      budget.components += 1;
      container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
      );
      return;
    }
    case "image": {
      const url = (props.url ?? props.image_url) as string | undefined;
      if (url) {
        budget.components += 1;
        container.addMediaGalleryComponents(
          new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url)),
        );
      }
      return;
    }
    case "actions": {
      for (const row of buildActionRows(childNodes(node))) {
        if (budget.components >= DISCORD_LIMITS.componentsPerMessage - 1) {
          signalOverflow(budget, container);
          break;
        }
        budget.components += 1;
        container.addActionRowComponents(row);
      }
      return;
    }
    case "table": {
      // Discord has no tables; emit a fenced text block via discordMarkdown over
      // a reconstructed pipe table. Fence-safe truncation keeps the closing ```.
      const md = tableToMarkdown(node);
      addText(
        truncateFenced(discordMarkdown(md), DISCORD_LIMITS.textDisplayChars),
        budget,
        container,
      );
      return;
    }
    case "input": {
      // Free-standing text inputs are modal-only on Discord; modals are deferred
      // to a follow-up. Log once and skip (total renderer).
      console.warn("[bot-discord] <Input> is modal-only; skipped (modals not in v1).");
      return;
    }
    default:
      return; // unknown intrinsic — skip
  }
}

/** Build action rows from a flat list of button/select children, chunking buttons ≤5/row. */
function buildActionRows(
  children: BotNode[],
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  let current: ButtonBuilder[] = [];

  const flushButtons = () => {
    if (current.length === 0) return;
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...current));
    current = [];
  };

  for (const child of children) {
    if (rows.length >= DISCORD_LIMITS.actionRows) break;
    if (child.type === "button") {
      const btn = buildButton(child);
      if (!btn) continue;
      current.push(btn);
      if (current.length === DISCORD_LIMITS.buttonsPerRow) flushButtons();
    } else if (child.type === "select") {
      flushButtons();
      const select = buildSelect(child);
      if (select) {
        rows.push(
          new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select),
        );
      }
    }
  }
  flushButtons();
  return rows.slice(0, DISCORD_LIMITS.actionRows);
}

function buildButton(node: BotNode): ButtonBuilder | undefined {
  const props = node.props ?? {};
  const id = idFromHandler(props.onClick) ?? packValueId(props.value);
  if (!id) return undefined;
  const btn = new ButtonBuilder()
    .setCustomId(truncateText(id, DISCORD_LIMITS.customId))
    .setLabel(truncateText(collectText(node) || " ", DISCORD_LIMITS.buttonLabel))
    .setStyle(buttonStyle(props.style));
  return btn;
}

function buildSelect(node: BotNode): StringSelectMenuBuilder | undefined {
  const props = node.props ?? {};
  const id = idFromHandler(props.onSelect);
  if (!id) return undefined;
  const options = (props.options as { label: string; value: unknown }[] | undefined) ?? [];
  // Clamp to Discord's 25-option cap. When options overflow, surface it rather
  // than silently dropping: reserve the last slot for a disabled "+N more…"
  // indicator (clamp, never silent drop).
  const { items, overflow } = clampArray(options, DISCORD_LIMITS.selectOptions);
  const built = (
    overflow > 0
      ? items.slice(0, DISCORD_LIMITS.selectOptions - 1)
      : items
  ).map((o) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(truncateText(o.label, 100))
      .setValue(truncateText(String(o.value), 100)),
  );
  if (overflow > 0) {
    // +1 for the option that the indicator displaces back into the overflow.
    built.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(truncateText(`+${overflow + 1} more…`, 100))
        .setValue("__overflow__"),
    );
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(truncateText(id, DISCORD_LIMITS.customId))
    .setPlaceholder(truncateText(String(props.placeholder ?? " "), DISCORD_LIMITS.selectPlaceholder))
    .addOptions(built);
  return select;
}

function buttonStyle(style: unknown): ButtonStyle {
  if (style === "primary") return ButtonStyle.Primary;
  if (style === "danger") return ButtonStyle.Danger;
  return ButtonStyle.Secondary;
}

/** Extract `{ id }` the action registry stamped onto an event prop. */
function idFromHandler(handler: unknown): string | undefined {
  if (handler && typeof handler === "object" && "id" in handler) {
    const id = (handler as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

/**
 * A button with no handler but a `value` still needs a stable custom_id. The
 * value is encoded as `v:<json>` so {@link unpackValue} can recover it. If that
 * encoding would exceed the custom_id cap we must NOT truncate — a truncated
 * JSON string is corrupt and silently decodes to undefined. Instead omit the
 * value entirely (caller falls back to the handler id) and warn.
 */
function packValueId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const id = "v:" + JSON.stringify(value);
  if (id.length > DISCORD_LIMITS.customId) {
    console.warn(
      "[bot-discord] button `value` too large to encode in a custom_id; dropping the bound value.",
    );
    return undefined;
  }
  return id;
}

const HEX6 = /^#?[0-9a-fA-F]{6}$/;

/**
 * "#5865F2" / "5865F2" / 0x5865F2 → integer; undefined if unparseable.
 * Strict: a string must be exactly 6 hex digits (optionally `#`-prefixed); a
 * number must fall within the 0..0xFFFFFF RGB range.
 */
function parseAccent(accent: unknown): number | undefined {
  if (typeof accent === "number") {
    if (!Number.isInteger(accent) || accent < 0 || accent > 0xffffff) return undefined;
    return accent;
  }
  if (typeof accent !== "string" || !HEX6.test(accent)) return undefined;
  return Number.parseInt(accent.replace(/^#/, ""), 16);
}

// ── helpers copied verbatim from bot-slack/src/render/block-kit.ts ──
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

function collectText(node: BotNode): string {
  if (typeof node.type === "string" && node.type === "text") {
    return String(node.props?.value ?? "");
  }
  let acc = "";
  for (const child of childNodes(node)) {
    acc += collectText(child);
  }
  return acc;
}

// Field label/value: a <Field label="..">value</Field> or text-only field.
function collectFieldLabel(node: BotNode): string {
  const label = node.props?.label;
  return typeof label === "string" ? label : "";
}
function collectFieldValue(node: BotNode): string {
  return collectText(node);
}

// Reconstruct a GFM pipe table from a <Table columns rows> node so
// discordMarkdown can fence it. Columns from props.columns; rows from row/cell.
function tableToMarkdown(node: BotNode): string {
  const columns =
    (node.props?.columns as { header: string }[] | undefined)?.map((c) => c.header) ?? [];
  const rows = childNodes(node)
    .filter((c) => c.type === "row")
    .map((r) => childNodes(r).filter((c) => c.type === "cell").map((c) => collectText(c)));
  const lines: string[] = [];
  if (columns.length) {
    lines.push(`| ${columns.join(" | ")} |`);
    lines.push(`| ${columns.map(() => "-").join(" | ")} |`);
  }
  for (const row of rows) lines.push(`| ${row.join(" | ")} |`);
  return lines.join("\n");
}

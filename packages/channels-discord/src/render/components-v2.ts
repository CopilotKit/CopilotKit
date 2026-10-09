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
} from "discord.js";
import type { MessageActionRowComponentBuilder } from "discord.js";
import type { ChannelNode } from "@copilotkit/channels-ui";
import {
  DISCORD_LIMITS,
  truncateText,
  truncateFenced,
  clampArray,
} from "./budget.js";
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

/** Guards one-time warnings so they don't fire on every render. */
let warnedInputSkipped = false;

/** True once the message is full; callers must stop adding components. */
function budgetFull(budget: RenderBudget): boolean {
  // Reserve room for one trailing overflow TextDisplay: one component slot plus
  // the marker's text length, so signalOverflow never pushes us over a cap.
  return (
    budget.components >= DISCORD_LIMITS.componentsPerMessage - 1 ||
    budget.textChars >= DISCORD_LIMITS.totalTextChars - OVERFLOW_TEXT.length
  );
}

/** Append a single trailing overflow marker (idempotent) when the budget is hit. */
function signalOverflow(
  budget: RenderBudget,
  container: ContainerBuilder,
): void {
  if (budget.overflowed) return;
  budget.overflowed = true;
  budget.components += 1;
  budget.textChars += OVERFLOW_TEXT.length;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(OVERFLOW_TEXT),
  );
}

/** Add a TextDisplay, charging the text budget and clamping to remaining room. */
function addText(
  content: string,
  budget: RenderBudget,
  container: ContainerBuilder,
): void {
  // Genuinely-empty INPUT (an empty <Text value="">, an empty <Fields>/<Context>/
  // <Table>) is not an overflow — skip it silently. Only a NON-empty content that
  // the budget clamps to empty signals truncation.
  if (content.length === 0) return;
  // Reserve room for one trailing overflow marker (mirrors the component-slot
  // reservation in budgetFull) so the summed text — including a marker that may
  // be appended later — never exceeds totalTextChars.
  const remaining =
    DISCORD_LIMITS.totalTextChars - OVERFLOW_TEXT.length - budget.textChars;
  let clamped = content;
  if (content.length > remaining) {
    const room = Math.max(0, remaining);
    // The cumulative clamp can sever a ``` fence emitted by the table/section
    // path. If the content carries a fence, use the fence-balancing truncation
    // so a cut fence is re-closed (kept within `room`).
    clamped = content.includes("```")
      ? truncateFenced(content, room)
      : truncateText(content, room);
  }
  // Discord rejects an empty TextDisplay. If the text budget clamped a non-empty
  // content down to empty, emit the overflow marker instead of an empty component.
  if (clamped.length === 0) {
    signalOverflow(budget, container);
    return;
  }
  budget.textChars += clamped.length;
  budget.components += 1;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(clamped),
  );
}

/**
 * Render a cross-platform IR tree (already expanded + action-bound, so event
 * props are `{ id }`) into a single top-level Components V2 `ContainerBuilder`.
 *
 * Total renderer: unknown intrinsics are skipped, never thrown. Per-element
 * limits apply via truncate/clamp; nothing is silently dropped.
 */
export function renderComponents(ir: ChannelNode[]): ContainerBuilder {
  const container = new ContainerBuilder();

  // <Message accent="#hex"> → container accent color.
  if (ir.length === 1 && ir[0]?.type === "message") {
    const accent = (ir[0].props as { accent?: unknown }).accent;
    const int = parseAccent(accent);
    if (int !== undefined) container.setAccentColor(int);
  }

  const budget: RenderBudget = {
    components: 0,
    textChars: 0,
    overflowed: false,
  };
  for (const node of ir) addNode(node, container, budget);
  return container;
}

/** Ready-to-send payload for channel.send / message.edit. */
export function renderDiscordMessage(ir: ChannelNode[]): {
  components: ContainerBuilder[];
  flags: number;
} {
  return {
    components: [renderComponents(ir)],
    flags: MessageFlags.IsComponentsV2,
  };
}

function addNode(
  node: ChannelNode,
  container: ContainerBuilder,
  budget: RenderBudget,
): void {
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
      addText(
        "# " + truncateText(collectText(node), DISCORD_LIMITS.headerText),
        budget,
        container,
      );
      return;
    }
    case "section":
    case "markdown":
    case "text": {
      const raw =
        node.type === "text" ? String(props.value ?? "") : collectText(node);
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
      const lines = fields.map((f) =>
        `**${collectFieldLabel(f)}** ${collectFieldValue(f)}`.trim(),
      );
      addText(
        truncateFenced(
          discordMarkdown(lines.join("\n")),
          DISCORD_LIMITS.textDisplayChars,
        ),
        budget,
        container,
      );
      return;
    }
    case "field": {
      addText(
        truncateFenced(
          discordMarkdown(collectText(node)),
          DISCORD_LIMITS.textDisplayChars,
        ),
        budget,
        container,
      );
      return;
    }
    case "context": {
      // Discord subtext: lines prefixed with `-# `.
      const parts = childNodes(node)
        .map((c) => collectText(c))
        .filter(Boolean);
      const body = parts.map((p) => `-# ${p}`).join("\n");
      addText(
        truncateText(body, DISCORD_LIMITS.textDisplayChars),
        budget,
        container,
      );
      return;
    }
    case "divider": {
      budget.components += 1;
      container.addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(true)
          .setSpacing(SeparatorSpacingSize.Small),
      );
      return;
    }
    case "image": {
      const url = (props.url ?? props.image_url) as string | undefined;
      if (url) {
        // Discord counts the MediaGallery PLUS every nested item toward the cap.
        // One image node = the gallery (1) + a single item (1).
        const cost = 1 + 1;
        if (
          budget.components + cost >
          DISCORD_LIMITS.componentsPerMessage - 1
        ) {
          signalOverflow(budget, container);
          return;
        }
        budget.components += cost;
        container.addMediaGalleryComponents(
          new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(url),
          ),
        );
      }
      return;
    }
    case "actions": {
      for (const row of buildActionRows(childNodes(node))) {
        // Discord counts the ActionRow PLUS every nested button/select toward the
        // componentsPerMessage cap. Charge the full nested cost and check the
        // projected total (reserving one slot for the overflow marker) before adding.
        const cost = 1 + row.components.length;
        if (
          budget.components + cost >
          DISCORD_LIMITS.componentsPerMessage - 1
        ) {
          signalOverflow(budget, container);
          break;
        }
        budget.components += cost;
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
      if (!warnedInputSkipped) {
        warnedInputSkipped = true;
        console.warn(
          "[bot-discord] <Input> is modal-only; skipped (modals not in v1).",
        );
      }
      return;
    }
    default:
      return; // unknown intrinsic — skip
  }
}

/** Build action rows from a flat list of button/select children, chunking buttons ≤5/row. */
function buildActionRows(
  children: ChannelNode[],
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  let current: ButtonBuilder[] = [];

  const flushButtons = () => {
    if (current.length === 0) return;
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        ...current,
      ),
    );
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
          new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            select,
          ),
        );
      }
    }
  }
  flushButtons();
  return rows.slice(0, DISCORD_LIMITS.actionRows);
}

function buildButton(node: ChannelNode): ButtonBuilder | undefined {
  const props = node.props ?? {};
  const label = truncateText(
    collectText(node) || " ",
    DISCORD_LIMITS.buttonLabel,
  );
  // Link button: opens a URL natively, carries no custom_id, never dispatches.
  if (typeof props.url === "string" && props.url.length > 0) {
    return new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(label)
      .setURL(props.url);
  }
  const id = buttonCustomId(idFromHandler(props.onClick), props.value);
  if (!id) return undefined;
  const btn = new ButtonBuilder()
    .setCustomId(truncateText(id, DISCORD_LIMITS.customId))
    .setLabel(label)
    .setStyle(buttonStyle(props.style));
  return btn;
}

function buildSelect(node: ChannelNode): StringSelectMenuBuilder | undefined {
  const props = node.props ?? {};
  const id = idFromHandler(props.onSelect);
  if (!id) return undefined;
  const options =
    (props.options as { label: string; value: unknown }[] | undefined) ?? [];
  // Clamp to Discord's 25-option cap. A fake "+N more…" indicator is NOT an
  // option here: it would be a selectable garbage value that dispatches as a
  // real selection. Drop the overflow and warn instead (clamp, never a bogus
  // selectable value).
  const { items, overflow } = clampArray(options, DISCORD_LIMITS.selectOptions);
  if (overflow > 0) {
    console.warn(
      `[bot-discord] <Select> has more than ${DISCORD_LIMITS.selectOptions} options; dropping ${overflow}.`,
    );
  }
  const built = items.map((o) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(truncateText(o.label, 100))
      .setValue(truncateText(String(o.value), 100)),
  );
  // Discord rejects a StringSelectMenu with zero options (needs 1..25). With no
  // options there's nothing selectable, so omit the select entirely (the caller
  // already filters undefined, mirroring the button path).
  if (built.length === 0) return undefined;
  const select = new StringSelectMenuBuilder()
    .setCustomId(truncateText(id, DISCORD_LIMITS.customId))
    // Truthy fallback so an explicit "" placeholder falls back to " " (Discord
    // rejects an empty placeholder), matching the button-label path.
    .setPlaceholder(
      truncateText(
        String(props.placeholder || " "),
        DISCORD_LIMITS.selectPlaceholder,
      ),
    )
    .addOptions(built);
  // Multi-select: allow 0..N picks. maxValues > 1 is also the signal the decoder
  // reads (interaction.component.maxValues) to return a string[] instead of one.
  if (props.multi) {
    select.setMinValues(0).setMaxValues(built.length);
  }
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

/**
 * A button can have BOTH an `onClick` (which updates the card in place) AND a
 * `value` (which resolves an `awaitChoice` waiter) — e.g. the HITL confirm
 * gate. Discord exposes only a single `custom_id` per button (unlike Slack's
 * separate `action_id` + `value`), so we pack both into it as
 * `<handlerId>;v:<json>`; {@link decodeInteraction} splits them back into a
 * dispatchable id and the bound value. Without this the value is dropped and
 * `awaitChoice` resolves to `undefined` (every approval reads as "declined").
 */
function buttonCustomId(
  handlerId: string | undefined,
  value: unknown,
): string | undefined {
  const valueId = packValueId(value);
  if (handlerId && valueId) {
    const combined = `${handlerId};${valueId}`;
    if (combined.length <= DISCORD_LIMITS.customId) return combined;
    console.warn(
      "[bot-discord] button onClick+value custom_id exceeds the 100-char cap; keeping the handler, dropping the bound value.",
    );
    return handlerId;
  }
  return handlerId ?? valueId;
}

const HEX6 = /^#?[0-9a-fA-F]{6}$/;

/**
 * "#5865F2" / "5865F2" / 0x5865F2 → integer; undefined if unparseable.
 * Strict: a string must be exactly 6 hex digits (optionally `#`-prefixed); a
 * number must fall within the 0..0xFFFFFF RGB range.
 */
function parseAccent(accent: unknown): number | undefined {
  if (typeof accent === "number") {
    if (!Number.isInteger(accent) || accent < 0 || accent > 0xffffff)
      return undefined;
    return accent;
  }
  if (typeof accent !== "string" || !HEX6.test(accent)) return undefined;
  return Number.parseInt(accent.replace(/^#/, ""), 16);
}

// ── helpers copied verbatim from bot-slack/src/render/block-kit.ts ──
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

// Field label/value: a <Field label="..">value</Field> or text-only field.
function collectFieldLabel(node: ChannelNode): string {
  const label = node.props?.label;
  return typeof label === "string" ? label : "";
}
function collectFieldValue(node: ChannelNode): string {
  return collectText(node);
}

// Reconstruct a GFM pipe table from a <Table columns rows> node so
// discordMarkdown can fence it. Columns from props.columns; rows from row/cell.
function tableToMarkdown(node: ChannelNode): string {
  const columns =
    (node.props?.columns as { header: string }[] | undefined)?.map(
      (c) => c.header,
    ) ?? [];
  const rows = childNodes(node)
    .filter((c) => c.type === "row")
    .map((r) =>
      childNodes(r)
        .filter((c) => c.type === "cell")
        .map((c) => collectText(c)),
    );
  const lines: string[] = [];
  if (columns.length) {
    lines.push(`| ${columns.join(" | ")} |`);
    lines.push(`| ${columns.map(() => "-").join(" | ")} |`);
  }
  for (const row of rows) lines.push(`| ${row.join(" | ")} |`);
  return lines.join("\n");
}

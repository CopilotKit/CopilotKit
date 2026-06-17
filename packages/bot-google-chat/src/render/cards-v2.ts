import type { BotNode } from "@copilotkit/bot-ui";
import { GCHAT_LIMITS, truncateText, clampArray } from "./budget.js";

type Widget = Record<string, unknown>;

/** The expanded children of an IR node as a BotNode[] (empty if none). */
function childrenOf(node: BotNode): BotNode[] {
  const c = node.props?.children;
  if (Array.isArray(c)) return c as BotNode[];
  if (c && typeof c === "object" && "type" in (c as object)) return [c as BotNode];
  return [];
}

/** Concatenate the text of all descendant `text` nodes (depth-first). */
function collectText(node: BotNode): string {
  if (typeof node.type === "string" && node.type === "text") {
    return String(node.props?.value ?? "");
  }
  return childrenOf(node).map(collectText).join(" ").trim();
}

/** True when the IR is a list of only plain text nodes — render as `{ text }` instead of a card. */
function isPlainText(ir: BotNode[]): boolean {
  return ir.every((n) => n.type === "text");
}

/** Extract the `ck:` action id stamped onto an event prop by the action registry, if present. */
function idFromHandler(handler: unknown): string | undefined {
  if (handler && typeof handler === "object" && "id" in (handler as object)) {
    const id = (handler as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

/** Derive a button's Google Chat `onClick.action.function` id: prefer the registry-stamped ck: id, else a stable fallback. */
function buttonFunctionId(props: Record<string, unknown>): string {
  const fromHandler = idFromHandler(props.onClick);
  if (fromHandler) return fromHandler;
  return props.value !== undefined ? JSON.stringify(props.value) : "action";
}

/** Render an `actions` node into a `buttonList` widget, or return null if no buttons. */
function renderActionsWidget(node: BotNode): Widget | null {
  const buttonNodes = childrenOf(node).filter(
    (c) => typeof c.type === "string" && c.type === "button",
  );
  const { items } = clampArray(buttonNodes, GCHAT_LIMITS.buttonsPerSet);
  if (items.length === 0) return null;

  const buttons = items.map((btn) => {
    const props = btn.props ?? {};
    const functionId = buttonFunctionId(props);
    const buttonObj: Record<string, unknown> = {
      text: truncateText(collectText(btn), GCHAT_LIMITS.buttonText),
      onClick: {
        action: {
          function: functionId,
          parameters: [
            {
              key: "value",
              value:
                props.value !== undefined
                  ? JSON.stringify(props.value)
                  : "",
            },
          ],
        },
      },
    };
    return buttonObj;
  });

  return { buttonList: { buttons } };
}

/** Render a single IR node into zero or more widgets. */
function renderNodeWidgets(node: BotNode): Widget[] {
  if (typeof node.type !== "string") return [];
  const widgets: Widget[] = [];

  switch (node.type) {
    case "message": {
      // Flatten message container children.
      for (const child of childrenOf(node)) {
        widgets.push(...renderNodeWidgets(child));
      }
      break;
    }
    case "header": {
      // Header is handled separately at the card level; skip here to avoid duplication.
      break;
    }
    case "section":
    case "markdown": {
      const txt = truncateText(collectText(node), GCHAT_LIMITS.textParagraph);
      if (txt) widgets.push({ textParagraph: { text: txt } });
      // Render any nested actions/button children as a buttonList widget.
      for (const child of childrenOf(node)) {
        if (typeof child.type === "string" && child.type === "actions") {
          const w = renderActionsWidget(child);
          if (w) widgets.push(w);
        }
      }
      break;
    }
    case "actions": {
      const w = renderActionsWidget(node);
      if (w) widgets.push(w);
      break;
    }
    case "divider": {
      widgets.push({ divider: {} });
      break;
    }
    case "image": {
      const props = node.props ?? {};
      const url = (props.url ?? props.image_url) as string | undefined;
      const alt = (props.alt ?? props.altText ?? "") as string;
      widgets.push({ image: { imageUrl: url ?? "", altText: alt } });
      break;
    }
    case "context": {
      const txt = truncateText(collectText(node), GCHAT_LIMITS.textParagraph);
      if (txt) widgets.push({ textParagraph: { text: `_${txt}_` } });
      break;
    }
    case "fields": {
      const fieldChildren = childrenOf(node).filter((c) => c.type === "field");
      for (const f of fieldChildren) {
        const txt = truncateText(collectText(f), GCHAT_LIMITS.decoratedTextTop);
        if (txt) widgets.push({ decoratedText: { topLabel: txt } });
      }
      break;
    }
    case "field": {
      const txt = truncateText(collectText(node), GCHAT_LIMITS.decoratedTextTop);
      if (txt) widgets.push({ decoratedText: { topLabel: txt } });
      break;
    }
    case "text": {
      const value = String((node.props ?? {}).value ?? "");
      if (value) {
        widgets.push({
          textParagraph: {
            text: truncateText(value, GCHAT_LIMITS.textParagraph),
          },
        });
      }
      break;
    }
    default:
      // Unknown intrinsic — skip silently (total renderer).
      break;
  }

  return widgets;
}

/**
 * Render a cross-platform component IR tree into a Google Chat message body.
 *
 * - Plain text-only IR (all `text` nodes) → `{ text }` (no card).
 * - Structured IR → `{ cardsV2: [{ cardId, card: { header?, sections } }] }`.
 *
 * Per-element Chat limits are applied via `truncateText` and `clampArray`; the
 * renderer is total — unknown node types are skipped rather than throwing.
 */
export function renderGoogleChatMessage(ir: BotNode[]): {
  cardsV2?: unknown[];
  text?: string;
} {
  // Flatten a top-level <message> container.
  const nodes =
    ir.length === 1 && ir[0]?.type === "message" ? childrenOf(ir[0]) : ir;

  if (isPlainText(nodes)) {
    const plain = nodes.map(collectText).join("\n").trim();
    return { text: plain || " " };
  }

  // Pull the first header node for the card header.
  const headerNode = nodes.find((n) => n.type === "header");
  const bodyNodes = nodes.filter((n) => n.type !== "header");

  let widgets: Widget[] = bodyNodes.flatMap(renderNodeWidgets);

  const { items: clampedWidgets } = clampArray(widgets, GCHAT_LIMITS.widgetsPerCard);

  const card: Record<string, unknown> = {
    sections: [{ widgets: clampedWidgets }],
  };

  if (headerNode) {
    card.header = {
      title: truncateText(collectText(headerNode), GCHAT_LIMITS.headerText),
    };
  }

  return { cardsV2: [{ cardId: "ck-card", card }] };
}

/** Alias used by the adapter's render(); returns the same `{ cardsV2 }` or `{ text }` body. */
export function renderCardsV2(
  ir: BotNode[],
): { cardsV2?: unknown[]; text?: string } {
  return renderGoogleChatMessage(ir);
}

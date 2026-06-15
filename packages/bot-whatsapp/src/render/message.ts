import type { BotNode } from "@copilotkit/bot-ui";
import { markdownToWhatsApp } from "../markdown-to-wa.js";
import { WA_LIMITS, truncateText, clampArray } from "./budget.js";

/** A Cloud API send payload (the body sans messaging_product/to, which the client adds). */
export type WhatsAppOutbound =
  | { type: "text"; text: { body: string; preview_url: boolean } }
  | { type: "image"; image: { link?: string; id?: string; caption?: string } }
  | { type: "document"; document: { link?: string; id?: string; filename?: string; caption?: string } }
  | { type: "interactive"; interactive: InteractiveButton | InteractiveList };

interface InteractiveButton {
  type: "button";
  body: { text: string };
  action: { buttons: Array<{ type: "reply"; reply: { id: string; title: string } }> };
}
interface InteractiveList {
  type: "list";
  body: { text: string };
  action: {
    button: string;
    sections: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>;
  };
}

/** A flattened actionable control extracted from the IR. */
interface Action {
  id: string;
  title: string;
}

/**
 * Lower `BotNode[]` IR to Cloud API payload(s).
 *
 * Strategy: collect (a) the prose text from text/section/header/markdown/
 * fields/table/context/divider nodes, and (b) actionable controls from
 * `button`/`select` nodes. Then decide a single shape:
 *   - 0 actions            → a text message (image nodes emitted separately).
 *   - 1..3 button actions   → interactive `button`.
 *   - 4..10 actions         → interactive `list`.
 *   - >10 actions           → numbered text menu (degraded).
 * Image nodes always emit their own image payload.
 */
export function renderWhatsAppMessage(ir: BotNode[]): WhatsAppOutbound[] {
  const out: WhatsAppOutbound[] = [];
  const prose: string[] = [];
  const actions: Action[] = [];
  let selectButtonLabel = "Choose";
  let hasSelect = false;

  const visit = (nodes: BotNode[]): void => {
    for (const n of nodes) {
      const t = typeof n.type === "string" ? n.type : "";
      switch (t) {
        case "image": {
          const url = n.props.url as string | undefined;
          if (url) {
            const alt = n.props.alt as string | undefined;
            out.push({ type: "image", image: { link: url, ...(alt ? { caption: alt } : {}) } });
          }
          break;
        }
        case "button": {
          const baseId = idFromHandler(n.props.onClick);
          const title = textOf(n.props.children);
          if (baseId) {
            actions.push({ id: buildControlId(baseId, n.props.value), title });
          }
          break;
        }
        case "select": {
          const baseId = idFromHandler(n.props.onSelect);
          selectButtonLabel = (n.props.placeholder as string | undefined) ?? "Choose";
          hasSelect = true;
          const opts = (n.props.options as Array<{ label: string; value: string }>) ?? [];
          if (baseId) {
            for (const o of opts) {
              actions.push({ id: buildControlId(baseId, o.value), title: o.label });
            }
          }
          break;
        }
        case "divider":
          prose.push("───");
          break;
        default: {
          // text-bearing containers: section/header/markdown/fields/table/context/etc.
          const txt = textOf(n.props.children);
          if (txt) prose.push(txt);
        }
      }
    }
  };
  visit(ir);

  const bodyText = prose.filter(Boolean).join("\n");

  if (actions.length === 0) {
    if (bodyText) out.unshift(textPayload(bodyText));
    return out;
  }

  if (actions.length <= WA_LIMITS.replyButtons && !hasSelect) {
    out.unshift(buttonPayload(bodyText || "​", actions));
    return out;
  }

  if (actions.length <= WA_LIMITS.listRows) {
    out.unshift(listPayload(bodyText || "​", selectButtonLabel, actions));
    return out;
  }

  // Degrade: numbered text menu.
  const numbered = actions.map((a, i) => `${i + 1}. ${a.title}`).join("\n");
  out.unshift(textPayload(`${bodyText}\n\n${numbered}`.trim()));
  return out;
}

function textPayload(body: string): WhatsAppOutbound {
  return {
    type: "text",
    text: {
      body: truncateText(markdownToWhatsApp(body), WA_LIMITS.bodyText),
      preview_url: false,
    },
  };
}

function buttonPayload(body: string, actions: Action[]): WhatsAppOutbound {
  const { items } = clampArray(actions, WA_LIMITS.replyButtons);
  return {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: truncateText(markdownToWhatsApp(body), WA_LIMITS.interactiveBody) },
      action: {
        buttons: items.map((a) => ({
          type: "reply" as const,
          reply: { id: a.id, title: truncateText(a.title, WA_LIMITS.buttonTitle) },
        })),
      },
    },
  };
}

function listPayload(body: string, buttonLabel: string, actions: Action[]): WhatsAppOutbound {
  const { items } = clampArray(actions, WA_LIMITS.listRows);
  return {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: truncateText(markdownToWhatsApp(body), WA_LIMITS.interactiveBody) },
      action: {
        button: truncateText(buttonLabel, WA_LIMITS.listButton),
        sections: [
          {
            rows: items.map((a) => ({
              id: a.id,
              title: truncateText(a.title, WA_LIMITS.rowTitle),
            })),
          },
        ],
      },
    },
  };
}

/** Extract the `{ id }` the registry stamped onto an event prop, if present. */
function idFromHandler(handler: unknown): string | undefined {
  if (handler && typeof handler === "object" && "id" in handler) {
    const id = (handler as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

/**
 * Build a reply-control id. A bare minted id is short and safe to clamp. When a
 * value must round-trip (WhatsApp replies carry only an id, no value field) we
 * encode `${id}::${JSON.stringify(value)}`; if that exceeds WhatsApp's 256-char
 * id limit it CANNOT round-trip, so we fail loudly rather than truncate (which
 * would make decodeInteraction silently parse garbage).
 */
function buildControlId(actionId: string, value: unknown): string {
  if (value === undefined) return truncateText(actionId, WA_LIMITS.controlId);
  const encoded = `${actionId}::${JSON.stringify(value)}`;
  if (encoded.length > WA_LIMITS.controlId) {
    throw new Error(
      `WhatsApp control value too large to round-trip: encoded id is ${encoded.length} chars ` +
        `(max ${WA_LIMITS.controlId}). Use a smaller value or a short key the handler maps.`,
    );
  }
  return encoded;
}

/** Flatten a `BotChildren` tree to a single text string (text nodes + nested children). */
function textOf(children: unknown): string {
  if (children == null || children === false || children === true) return "";
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textOf).join("");
  const node = children as BotNode;
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node.props as Record<string, unknown>).children);
  }
  return "";
}

import type { ChannelNode } from "@copilotkit/channels-ui";
import { markdownToWhatsApp } from "../markdown-to-wa.js";
import { WA_LIMITS, truncateText, clampArray } from "./budget.js";

/** A Cloud API send payload (the body sans messaging_product/to, which the client adds). */
export type WhatsAppOutbound =
  | { type: "text"; text: { body: string; preview_url: boolean } }
  | { type: "image"; image: { link?: string; id?: string; caption?: string } }
  | {
      type: "document";
      document: {
        link?: string;
        id?: string;
        filename?: string;
        caption?: string;
      };
    }
  | {
      type: "interactive";
      interactive: InteractiveButton | InteractiveList | InteractiveCarousel;
    };

interface InteractiveButton {
  type: "button";
  body: { text: string };
  action: {
    buttons: Array<{ type: "reply"; reply: { id: string; title: string } }>;
  };
}
interface InteractiveList {
  type: "list";
  body: { text: string };
  action: {
    button: string;
    sections: Array<{
      title?: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>;
  };
}

interface CarouselCard {
  card_index: number;
  type: "cta_url";
  header: { type: "image"; image: { id?: string; link?: string } };
  body?: { text: string };
  action: CarouselCardAction;
}

type CarouselCardAction =
  | { name: "cta_url"; parameters: { display_text: string; url: string } }
  | {
      buttons: Array<{
        type: "quick_reply";
        quick_reply: { id: string; title: string };
      }>;
    };

interface InteractiveCarousel {
  type: "carousel";
  body: { text: string };
  action: { cards: CarouselCard[] };
}

/** A flattened actionable control extracted from the IR. */
interface Action {
  id: string;
  title: string;
}

/**
 * Synthetic base id for a value-only button (one with a `value` but no
 * `onClick`/`onSelect` — e.g. an `awaitChoice` HITL confirm–cancel pair). There's
 * no handler to dispatch; the value is encoded into the reply id so it round-trips
 * and the engine's awaiting waiter resolves with it.
 */
const VALUE_ONLY_ID = "wa:choice";

/**
 * Lower `ChannelNode[]` IR to Cloud API payload(s).
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
export function renderWhatsAppMessage(ir: ChannelNode[]): WhatsAppOutbound[] {
  const out: WhatsAppOutbound[] = [];
  const prose: string[] = [];
  const headers: string[] = [];
  const actions: Action[] = [];
  let selectButtonLabel = "Choose";
  let hasSelect = false;

  // Walk the whole IR tree. `renderToIR` lowers text into `{ type: "text",
  // props: { value } }` leaf nodes and nests controls inside containers
  // (`message` > `actions` > `button`), so we must recurse — collecting prose
  // from text leaves and actionable controls wherever they appear, at any depth.
  const visitChildren = (children: unknown): void => {
    if (children == null || typeof children === "boolean") return;
    if (typeof children === "string") {
      if (children) prose.push(children);
      return;
    }
    if (typeof children === "number") {
      prose.push(String(children));
      return;
    }
    if (Array.isArray(children)) {
      for (const c of children) visitChildren(c);
      return;
    }
    if (typeof children === "object" && "type" in (children as object)) {
      visitNode(children as ChannelNode);
    }
  };

  const visitNode = (n: ChannelNode): void => {
    const t = typeof n.type === "string" ? n.type : "";
    switch (t) {
      case "text": {
        const v = (n.props as Record<string, unknown>).value;
        if (typeof v === "string") {
          if (v) prose.push(v);
        } else if (typeof v === "number") {
          prose.push(String(v));
        }
        return; // text leaves carry no children
      }
      case "image":
      case "render": {
        const image = imageFromProps(n.props);
        if (image) out.push(imagePayload(image));
        return;
      }
      case "header": {
        const headerText = textOf(n.props.children);
        if (headerText) headers.push(headerText);
        return;
      }
      case "carousel": {
        const slides = childNodes(n).map(parseSlide);
        const mode = nativeCarouselMode(slides);
        if (mode) {
          const body = headers.pop() ?? " ";
          out.push(carouselPayload(body, slides, mode));
        } else {
          for (const slide of slides) {
            if (!slide.image) continue;
            out.push(imagePayload(slide.image, slideCaption(slide)));
          }
        }
        return;
      }
      case "carouselCard": {
        const slide = parseSlide(n);
        if (slide.image)
          out.push(imagePayload(slide.image, slideCaption(slide)));
        return;
      }
      case "button": {
        const title = textOf(n.props.children);
        const handlerId = idFromHandler(n.props.onClick);
        if (handlerId) {
          // Handler-bound button: dispatch via the minted id (value round-trips too).
          actions.push({ id: buildControlId(handlerId, n.props.value), title });
        } else if (n.props.value !== undefined) {
          // Value-only button (e.g. awaitChoice / HITL confirm–cancel): there's no
          // handler to dispatch, but the value MUST round-trip so the engine's
          // waiter resolves. Encode it behind a synthetic base id; decodeInteraction
          // splits it back into `{ value }` and the awaiting waiter takes it.
          actions.push({
            id: buildControlId(VALUE_ONLY_ID, n.props.value),
            title,
          });
        }
        // A button with neither a handler nor a value can't round-trip → skip.
        return;
      }
      case "select": {
        const baseId = idFromHandler(n.props.onSelect);
        selectButtonLabel =
          (n.props.placeholder as string | undefined) ?? "Choose";
        hasSelect = true;
        const opts =
          (n.props.options as Array<{ label: string; value: string }>) ?? [];
        if (baseId) {
          for (const o of opts) {
            actions.push({
              id: buildControlId(baseId, o.value),
              title: o.label,
            });
          }
        }
        return;
      }
      case "divider":
        prose.push("───");
        return;
      default:
        // Containers (message/section/markdown/fields/table/context/actions/…)
        // and unknown nodes: recurse into children.
        visitChildren(n.props.children);
    }
  };

  for (const n of ir) visitNode(n);

  const bodyText = [...headers, ...prose].filter(Boolean).join("\n");

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
      body: {
        text: truncateText(markdownToWhatsApp(body), WA_LIMITS.interactiveBody),
      },
      action: {
        buttons: items.map((a) => ({
          type: "reply" as const,
          reply: {
            id: a.id,
            title: truncateText(a.title, WA_LIMITS.buttonTitle),
          },
        })),
      },
    },
  };
}

function listPayload(
  body: string,
  buttonLabel: string,
  actions: Action[],
): WhatsAppOutbound {
  const { items } = clampArray(actions, WA_LIMITS.listRows);
  return {
    type: "interactive",
    interactive: {
      type: "list",
      body: {
        text: truncateText(markdownToWhatsApp(body), WA_LIMITS.interactiveBody),
      },
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

interface SlideImage {
  id?: string;
  link?: string;
  alt?: string;
}

interface SlideButton {
  title: string;
  url?: string;
  id?: string;
}

interface ParsedSlide {
  image?: SlideImage;
  header?: string;
  section?: string;
  buttons: SlideButton[];
}

function childNodes(n: ChannelNode): ChannelNode[] {
  const c = n.props?.children;
  if (c == null || typeof c === "boolean") return [];
  const list = Array.isArray(c) ? c : [c];
  return list.filter(
    (x): x is ChannelNode => typeof x === "object" && x !== null && "type" in x,
  );
}

function imageFromProps(
  props: Record<string, unknown> | undefined,
): SlideImage | undefined {
  if (!props) return undefined;
  const alt = (props.alt as string | undefined) || undefined;
  const mediaId = [props.fileId, props.slackFileId].find(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  if (mediaId) return { id: mediaId, alt };
  const url = (props.url ?? props.image_url) as string | undefined;
  if (url) return { link: url, alt };
  return undefined;
}

function imagePayload(image: SlideImage, caption?: string): WhatsAppOutbound {
  const cap = caption ?? image.alt;
  return {
    type: "image",
    image: {
      ...(image.id ? { id: image.id } : { link: image.link }),
      ...(cap ? { caption: cap } : {}),
    },
  };
}

function parseButton(n: ChannelNode): SlideButton | undefined {
  const title = textOf(n.props.children);
  const url = n.props.url;
  if (typeof url === "string" && url.length > 0) {
    return { title, url };
  }
  const handlerId = idFromHandler(n.props.onClick);
  if (handlerId) {
    return { title, id: buildControlId(handlerId, n.props.value) };
  }
  if (n.props.value !== undefined) {
    return { title, id: buildControlId(VALUE_ONLY_ID, n.props.value) };
  }
  return undefined;
}

function parseSlide(slide: ChannelNode): ParsedSlide {
  if (slide.type === "image" || slide.type === "render") {
    return { image: imageFromProps(slide.props), buttons: [] };
  }
  const parsed: ParsedSlide = { buttons: [] };
  if (slide.type !== "carouselCard") return parsed;
  for (const child of childNodes(slide)) {
    if (child.type === "image" || child.type === "render") {
      parsed.image = imageFromProps(child.props);
    } else if (child.type === "header") {
      const t = textOf(child.props.children);
      if (t) parsed.header = t;
    } else if (child.type === "section") {
      const t = textOf(child.props.children);
      if (t) parsed.section = t;
    } else if (child.type === "button") {
      const button = parseButton(child);
      if (button) parsed.buttons.push(button);
    }
  }
  return parsed;
}

function slideCaption(slide: ParsedSlide): string | undefined {
  const parts = [slide.header, slide.section].filter(Boolean);
  if (parts.length > 0) return parts.join("\n");
  return slide.image?.alt;
}

/**
 * Native carousel only when every slide has an image, 2–10 slides, the same
 * button count (>= 1), and either all URL (exactly one per card) or all
 * quick-reply. Mixed or unmatched slides fall back to sequential images.
 */
function nativeCarouselMode(
  slides: ParsedSlide[],
): "quick_reply" | "cta_url" | null {
  if (slides.length < 2 || slides.length > WA_LIMITS.carouselSlides) {
    return null;
  }
  if (!slides.every((s) => s.image && (s.image.id || s.image.link)))
    return null;
  const count = slides[0]!.buttons.length;
  if (count < 1) return null;
  if (!slides.every((s) => s.buttons.length === count)) return null;
  const allUrl = slides.every((s) => s.buttons.every((b) => !!b.url));
  const allQuickReply = slides.every((s) => s.buttons.every((b) => !b.url));
  // Meta allows one URL button per card, or one or more matching quick-replies.
  if (allUrl && count === 1) return "cta_url";
  if (allQuickReply) return "quick_reply";
  return null;
}

function carouselPayload(
  body: string,
  slides: ParsedSlide[],
  mode: "quick_reply" | "cta_url",
): WhatsAppOutbound {
  return {
    type: "interactive",
    interactive: {
      type: "carousel",
      body: {
        text: truncateText(markdownToWhatsApp(body), WA_LIMITS.interactiveBody),
      },
      action: {
        cards: slides.map((slide, card_index) => {
          const sectionText = slide.section
            ? truncateText(
                markdownToWhatsApp(slide.section),
                WA_LIMITS.carouselCardBody,
              )
            : undefined;
          const image = slide.image!;
          const card: CarouselCard = {
            card_index,
            type: "cta_url",
            header: {
              type: "image",
              image: image.id ? { id: image.id } : { link: image.link },
            },
            ...(sectionText ? { body: { text: sectionText } } : {}),
            action:
              mode === "cta_url"
                ? {
                    name: "cta_url",
                    parameters: {
                      display_text: truncateText(
                        slide.buttons[0]!.title,
                        WA_LIMITS.buttonTitle,
                      ),
                      url: slide.buttons[0]!.url!,
                    },
                  }
                : {
                    buttons: slide.buttons.map((b) => ({
                      type: "quick_reply" as const,
                      quick_reply: {
                        id: b.id!,
                        title: truncateText(b.title, WA_LIMITS.buttonTitle),
                      },
                    })),
                  },
          };
          return card;
        }),
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

/**
 * Flatten a `BotChildren` tree to a single text string. Handles both plain
 * string children and `renderToIR`-lowered `{ type: "text", props: { value } }`
 * leaf nodes.
 */
function textOf(children: unknown): string {
  if (children == null || children === false || children === true) return "";
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textOf).join("");
  const node = children as ChannelNode;
  if (node && typeof node === "object" && "props" in node) {
    const props = node.props as Record<string, unknown>;
    if (
      node.type === "text" &&
      (typeof props.value === "string" || typeof props.value === "number")
    ) {
      return String(props.value);
    }
    return textOf(props.children);
  }
  return "";
}

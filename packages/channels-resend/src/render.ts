import { isHostElement } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";

/** One rendered email body: HTML plus its plain-text alternative. */
export interface EmailBody {
  html: string;
  text: string;
}

/** A clickable control the renderer found: a handler button or one select option. */
export interface EmailControl {
  /** The minted action id core put on the control. */
  actionId: string;
  /** The value a click sends. */
  value?: unknown;
  /** The visible label. */
  label: string;
  /** `"option"` for one option of a `<Select>`. */
  kind: "button" | "option";
}

export interface RenderOptions {
  /**
   * Return a URL for a control, or `undefined` to drop it. Without this
   * option every handler control is dropped and only its label stays.
   */
  linkFor?: (control: EmailControl) => string | undefined;
}

const COLORS = {
  text: "#1f2328",
  muted: "#59636e",
  border: "#d1d9e0",
  subtle: "#f6f8fa",
  primary: "#1f6feb",
  danger: "#cf222e",
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

/** Escape text for HTML element content and attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only web and mail links are allowed in `href`/`src`. */
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const url = value.trim();
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : undefined;
}

function isNode(value: unknown): value is ChannelNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "props" in value &&
    !isHostElement(value)
  );
}

function childList(value: unknown): unknown[] {
  if (value === undefined || value === null || typeof value === "boolean") {
    return [];
  }
  return Array.isArray(value) ? value.flat(Infinity) : [value];
}

/** The minted action id core put on a handler prop (`{ id }`). */
function actionIdOf(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "object" && value !== null && "id" in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return undefined;
}

/** Plain text of a subtree. */
export function plainText(value: unknown): string {
  return childList(value)
    .map((child) => {
      if (typeof child === "string") return child;
      if (typeof child === "number") return String(child);
      if (!isNode(child)) return "";
      if (child.type === "text") {
        const v = child.props.value;
        return typeof v === "string" || typeof v === "number" ? String(v) : "";
      }
      return plainText(child.props.children);
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Markdown (the subset agents write) → HTML / text
// ---------------------------------------------------------------------------

/** Inline markdown on already-escaped text: code, links, bold, italic. */
function inlineMarkdown(escaped: string): string {
  const codes: string[] = [];
  let out = escaped.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    codes.push(
      `<code style="font-family:Menlo,Consolas,monospace;font-size:13px;background:${COLORS.subtle};padding:1px 4px;border-radius:4px">${code}</code>`,
    );
    return `\uE000${codes.length - 1}\uE000`;
  });
  out = out.replace(
    /\[([^\]\n]+)\]\(([^)\s]+)\)/g,
    (match, label: string, href: string) => {
      const url = safeUrl(href);
      return url
        ? `<a href="${url}" style="color:${COLORS.primary}">${label}</a>`
        : match;
    },
  );
  out = out
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
  return out.replace(
    /\uE000(\d+)\uE000/g,
    (_m, i: string) => codes[Number(i)]!,
  );
}

const P_STYLE = "margin:0 0 12px 0";

/** Convert agent markdown to email-safe HTML. All text is escaped first. */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | undefined;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      `<p style="${P_STYLE}">${paragraph.map((l) => inlineMarkdown(escapeHtml(l))).join("<br>")}</p>`,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? "ol" : "ul";
    blocks.push(
      `<${tag} style="margin:0 0 12px 0;padding-left:24px">${list.items
        .map((i) => `<li>${inlineMarkdown(escapeHtml(i))}</li>`)
        .join("")}</${tag}>`,
    );
    list = undefined;
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    blocks.push(
      `<blockquote style="margin:0 0 12px 0;padding:0 12px;border-left:3px solid ${COLORS.border};color:${COLORS.muted}">${quote
        .map((l) => inlineMarkdown(escapeHtml(l)))
        .join("<br>")}</blockquote>`,
    );
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = line.match(/^\s*```/);
    if (fence) {
      flushAll();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) {
        code.push(lines[i]!);
        i++;
      }
      blocks.push(
        `<pre style="margin:0 0 12px 0;padding:12px;background:${COLORS.subtle};border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:13px;white-space:pre-wrap">${escapeHtml(code.join("\n"))}</pre>`,
      );
      continue;
    }
    if (line.trim() === "") {
      flushAll();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      const size = Math.max(15, 22 - heading[1]!.length * 2);
      blocks.push(
        `<p style="margin:0 0 12px 0;font-size:${size}px;font-weight:600">${inlineMarkdown(escapeHtml(heading[2]!))}</p>`,
      );
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph();
      flushQuote();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    const quoted = line.match(/^\s*>\s?(.*)$/);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]!);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      blocks.push(divider());
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line);
  }
  flushAll();
  return blocks.join("");
}

/** Plain-text version of agent markdown: links spelled out, emphasis markers removed. */
export function markdownToText(markdown: string): string {
  return markdown
    .replace(
      /\[([^\]\n]+)\]\(([^)\s]+)\)/g,
      (_m, label: string, href: string) =>
        label === href ? href : `${label} (${href})`,
    )
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .trim();
}

// ---------------------------------------------------------------------------
// Channel IR → HTML / text
// ---------------------------------------------------------------------------

function divider(): string {
  return `<hr style="border:none;border-top:1px solid ${COLORS.border};margin:16px 0">`;
}

function buttonHtml(label: string, href: string, style: unknown): string {
  const background =
    style === "danger"
      ? COLORS.danger
      : style === "primary"
        ? COLORS.primary
        : "#ffffff";
  const color =
    style === "danger" || style === "primary" ? "#ffffff" : COLORS.text;
  return `<a href="${escapeHtml(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:8px 14px;border:1px solid ${style === "danger" || style === "primary" ? background : COLORS.border};border-radius:6px;background:${background};color:${color};text-decoration:none;font-weight:600;font-size:14px">${escapeHtml(label)}</a>`;
}

function safeColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^#[0-9a-f]{3,8}$/i.test(value) || /^[a-z]{3,20}$/i.test(value)
    ? value
    : undefined;
}

interface Out {
  html: string[];
  text: string[];
}

class EmailRenderer {
  constructor(private readonly opts: RenderOptions) {}

  render(nodes: unknown): Out {
    const out: Out = { html: [], text: [] };
    for (const child of childList(nodes)) this.block(child, out);
    return out;
  }

  private block(value: unknown, out: Out): void {
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value);
      if (!text) return;
      out.html.push(markdownToHtml(text));
      out.text.push(markdownToText(text));
      return;
    }
    if (!isNode(value) || typeof value.type !== "string") return;
    const node = value;
    const props = node.props;
    switch (node.type) {
      case "text": {
        const text = plainText([node]);
        if (!text) return;
        out.html.push(markdownToHtml(text));
        out.text.push(markdownToText(text));
        return;
      }
      case "message": {
        const inner = this.render(props.children);
        const accent = safeColor(props.accent);
        const html = inner.html.join("");
        out.html.push(
          accent
            ? `<div style="border-left:4px solid ${accent};padding-left:12px">${html}</div>`
            : html,
        );
        const text = inner.text.join("\n\n");
        out.text.push(
          text ||
            (typeof props.fallbackText === "string" ? props.fallbackText : ""),
        );
        return;
      }
      case "header": {
        const text = plainText(props.children).trim();
        if (!text) return;
        out.html.push(
          `<p style="margin:0 0 12px 0;font-size:18px;font-weight:600">${escapeHtml(text)}</p>`,
        );
        out.text.push(text);
        return;
      }
      case "section":
      case "markdown": {
        const text = plainText(props.children).trim();
        if (text) {
          out.html.push(markdownToHtml(text));
          out.text.push(markdownToText(text));
        }
        // Controls nested in a section (an accessory button).
        this.controlsIn(props.children, out);
        return;
      }
      case "context": {
        const text = plainText(props.children).trim();
        if (!text) return;
        out.html.push(
          `<p style="margin:0 0 12px 0;font-size:12px;color:${COLORS.muted}">${inlineMarkdown(escapeHtml(text))}</p>`,
        );
        out.text.push(markdownToText(text));
        return;
      }
      case "divider":
        out.html.push(divider());
        out.text.push("---");
        return;
      case "fields": {
        const rows: string[] = [];
        const lines: string[] = [];
        for (const field of childList(props.children)) {
          if (!isNode(field) || field.type !== "field") continue;
          const label =
            typeof field.props.label === "string" ? field.props.label : "";
          const val = plainText(field.props.children).trim();
          rows.push(
            `<tr><td style="padding:2px 16px 2px 0;color:${COLORS.muted};vertical-align:top">${escapeHtml(label)}</td><td style="padding:2px 0">${inlineMarkdown(escapeHtml(val))}</td></tr>`,
          );
          lines.push(
            label ? `${label}: ${markdownToText(val)}` : markdownToText(val),
          );
        }
        if (rows.length === 0) return;
        out.html.push(
          `<table role="presentation" style="border-collapse:collapse;margin:0 0 12px 0;font-size:14px">${rows.join("")}</table>`,
        );
        out.text.push(lines.join("\n"));
        return;
      }
      case "field": {
        const label = typeof props.label === "string" ? props.label : "";
        const val = plainText(props.children).trim();
        const text = label ? `${label}: ${val}` : val;
        if (!text) return;
        out.html.push(`<p style="${P_STYLE}">${escapeHtml(text)}</p>`);
        out.text.push(text);
        return;
      }
      case "image":
      case "render": {
        const alt = typeof props.alt === "string" ? props.alt : "";
        const src = node.type === "image" ? safeUrl(props.url) : undefined;
        if (src) {
          out.html.push(
            `<p style="${P_STYLE}"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" style="max-width:100%;height:auto;border:0"></p>`,
          );
          out.text.push(alt ? `${alt}: ${src}` : src);
        } else if (alt) {
          out.html.push(`<p style="${P_STYLE}">${escapeHtml(alt)}</p>`);
          out.text.push(alt);
        }
        return;
      }
      case "table":
        this.table(node, out);
        return;
      case "chart":
        this.chart(node, out);
        return;
      case "actions": {
        this.controlsIn(props.children, out);
        return;
      }
      case "button":
      case "select":
        this.controlsIn([node], out);
        return;
      case "carouselCard": {
        const inner = this.render(props.children);
        out.html.push(
          `<div style="border:1px solid ${COLORS.border};border-radius:8px;padding:12px 12px 0 12px;margin:0 0 12px 0">${inner.html.join("")}</div>`,
        );
        out.text.push(inner.text.join("\n"));
        return;
      }
      case "input":
      case "raw":
        // Free-text inputs cannot work in email; provider-native payloads are not email.
        return;
      default: {
        const inner = this.render(props.children);
        out.html.push(...inner.html);
        out.text.push(...inner.text);
      }
    }
  }

  /** Render the buttons and selects directly inside `children` as one row. */
  private controlsIn(children: unknown, out: Out): void {
    const html: string[] = [];
    const text: string[] = [];
    for (const child of childList(children)) {
      if (!isNode(child)) continue;
      if (child.type === "button") this.button(child, html, text);
      else if (child.type === "select") this.select(child, html, text);
    }
    if (html.length === 0) return;
    out.html.push(`<p style="margin:4px 0 12px 0">${html.join("")}</p>`);
    out.text.push(text.join("\n"));
  }

  private button(node: ChannelNode, html: string[], text: string[]): void {
    const label = plainText(node.props.children).trim() || "Open";
    const url = safeUrl(node.props.url);
    if (url) {
      html.push(buttonHtml(label, url, node.props.style));
      text.push(`${label}: ${url}`);
      return;
    }
    const actionId = actionIdOf(node.props.onClick);
    const href = actionId
      ? this.opts.linkFor?.({
          actionId,
          value: node.props.value,
          label,
          kind: "button",
        })
      : undefined;
    if (href) {
      html.push(buttonHtml(label, href, node.props.style));
      text.push(`${label}: ${href}`);
      return;
    }
    // No way to act on it by email: keep the label as plain text.
    html.push(
      `<span style="display:inline-block;margin:0 12px 8px 0;color:${COLORS.muted}">${escapeHtml(label)}</span>`,
    );
    text.push(label);
  }

  private select(node: ChannelNode, html: string[], text: string[]): void {
    const options = Array.isArray(node.props.options)
      ? (node.props.options as Array<{ label?: unknown; value?: unknown }>)
      : [];
    const placeholder =
      typeof node.props.placeholder === "string" ? node.props.placeholder : "";
    const actionId = actionIdOf(node.props.onSelect);
    const labels: string[] = [];
    const parts: string[] = [];
    const lines: string[] = [];
    for (const option of options) {
      const label = String(option.label ?? option.value ?? "");
      const value = option.value;
      const href = actionId
        ? this.opts.linkFor?.({ actionId, value, label, kind: "option" })
        : undefined;
      if (href) {
        parts.push(buttonHtml(label, href, undefined));
        lines.push(`${label}: ${href}`);
      } else {
        labels.push(label);
      }
    }
    if (labels.length > 0) lines.push(labels.join(" · "));
    if (lines.length === 0) return;
    if (placeholder) {
      html.push(
        `<span style="display:block;margin:0 0 6px 0;color:${COLORS.muted}">${escapeHtml(placeholder)}</span>`,
      );
      lines.unshift(placeholder);
    }
    html.push(...parts);
    if (labels.length > 0) {
      html.push(
        `<span style="display:inline-block;margin:0 0 8px 0;color:${COLORS.muted}">${labels.map(escapeHtml).join(" · ")}</span>`,
      );
    }
    text.push(...lines);
  }

  private table(node: ChannelNode, out: Out): void {
    const columns = Array.isArray(node.props.columns)
      ? (node.props.columns as Array<{ header?: unknown; align?: unknown }>)
      : [];
    const cell = "padding:6px 10px;border:1px solid " + COLORS.border;
    const head = columns.length
      ? `<tr>${columns
          .map(
            (c) =>
              `<th style="${cell};background:${COLORS.subtle};text-align:left">${escapeHtml(String(c.header ?? ""))}</th>`,
          )
          .join("")}</tr>`
      : "";
    const rows: string[] = [];
    const lines: string[] = columns.length
      ? [columns.map((c) => String(c.header ?? "")).join(" | ")]
      : [];
    for (const row of childList(node.props.children)) {
      if (!isNode(row)) continue;
      const cells = childList(row.props.children)
        .filter(isNode)
        .map((c) => plainText(c.props.children).trim());
      const aligned = cells.map((value, i) => {
        const align = columns[i]?.align;
        const style =
          align === "center" || align === "right" ? `;text-align:${align}` : "";
        return `<td style="${cell}${style}">${escapeHtml(value)}</td>`;
      });
      rows.push(`<tr>${aligned.join("")}</tr>`);
      lines.push(cells.join(" | "));
    }
    if (!head && rows.length === 0) return;
    out.html.push(
      `<table style="border-collapse:collapse;margin:0 0 12px 0;font-size:14px">${head}${rows.join("")}</table>`,
    );
    out.text.push(lines.join("\n"));
  }

  private chart(node: ChannelNode, out: Out): void {
    const data = Array.isArray(node.props.data)
      ? (node.props.data as Array<{ label?: unknown; value?: unknown }>)
      : [];
    const title = typeof node.props.title === "string" ? node.props.title : "";
    const rows = data.map((d) => ({
      type: "row",
      props: {
        children: [
          { type: "cell", props: { children: [String(d.label ?? "")] } },
          { type: "cell", props: { children: [String(d.value ?? "")] } },
        ],
      },
    }));
    if (title) {
      out.html.push(
        `<p style="margin:0 0 8px 0;font-weight:600">${escapeHtml(title)}</p>`,
      );
      out.text.push(title);
    }
    this.table({ type: "table", props: { children: rows } }, out);
  }
}

/** Wrap rendered content in a minimal, email-client-safe HTML document. */
function documentHtml(content: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#ffffff"><div style="font-family:${FONT};font-size:14px;line-height:1.5;color:${COLORS.text};max-width:640px;padding:16px">${content}</div></body></html>`;
}

/**
 * Render channel UI to an email body: inline-styled HTML plus a plain-text
 * alternative. All text is HTML-escaped. Handler buttons and select options
 * become links only when `opts.linkFor` returns a URL for them; otherwise
 * their labels stay as plain text. Inputs and provider-native `raw` nodes
 * are dropped.
 */
export function renderEmail(
  ir: readonly unknown[],
  opts: RenderOptions = {},
): EmailBody {
  const out = new EmailRenderer(opts).render(ir);
  return {
    html: documentHtml(out.html.join("")),
    text: out.text.filter((t) => t.length > 0).join("\n\n"),
  };
}

/** Render agent markdown text to an email body. */
export function renderMarkdownEmail(markdown: string): EmailBody {
  return {
    html: documentHtml(markdownToHtml(markdown)),
    text: markdownToText(markdown),
  };
}

import { isHostElement } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { escapeHtml, markdownToHtml, safeUrl } from "./markdown.js";

/** One email body: HTML and the plain-text alternative. */
export interface EmailBody {
  html: string;
  text: string;
}

/** A control that runs a handler: a button or one select option. */
export interface LinkControl {
  /** Minted action id. */
  id: string;
  value?: unknown;
  label: string;
}

export interface RenderOptions {
  /**
   * Return the signed URL for a handler control, or `undefined` when action
   * links are off. Without links, a handler control keeps only its label.
   */
  link?: (control: LinkControl) => string | undefined;
}

const FONT =
  "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2328";
const BUTTON_STYLE =
  "display:inline-block;margin:0 8px 8px 0;padding:8px 16px;border-radius:6px;background:#1f6feb;color:#ffffff;text-decoration:none;font-weight:600";
const DANGER_STYLE =
  "display:inline-block;margin:0 8px 8px 0;padding:8px 16px;border-radius:6px;background:#cf222e;color:#ffffff;text-decoration:none;font-weight:600";
const SECONDARY_STYLE =
  "display:inline-block;margin:0 8px 8px 0;padding:8px 16px;border-radius:6px;border:1px solid #d0d7de;background:#f6f8fa;color:#1f2328;text-decoration:none;font-weight:600";
const LABEL_STYLE =
  "display:inline-block;margin:0 8px 8px 0;padding:8px 16px;border-radius:6px;border:1px dashed #d0d7de;color:#57606a";
const CELL_STYLE =
  "border:1px solid #d0d7de;padding:6px 10px;text-align:left;vertical-align:top";

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
  return Array.isArray(value) ? value.flat(Infinity as 1) : [value];
}

function children(node: ChannelNode): unknown[] {
  return childList(node.props.children);
}

/** Plain text of a node's inline content. */
function textOf(value: unknown): string {
  return childList(value)
    .map((child) => {
      if (typeof child === "string") return child;
      if (typeof child === "number") return String(child);
      if (!isNode(child)) return "";
      if (child.type === "text") {
        const v = child.props.value;
        return typeof v === "string" || typeof v === "number" ? String(v) : "";
      }
      return textOf(child.props.children);
    })
    .join("");
}

/** The minted id of a bound handler prop. */
function handlerId(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "id" in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

interface Out {
  html: string[];
  text: string[];
}

class EmailRenderer {
  constructor(private readonly opts: RenderOptions) {}

  render(ir: readonly ChannelNode[]): EmailBody {
    const out: Out = { html: [], text: [] };
    for (const node of ir) this.node(node, out);
    return {
      html: `<div style="${FONT}">\n${out.html.join("\n")}\n</div>`,
      text: out.text
        .join("\n\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    };
  }

  private nodes(list: unknown[], out: Out): void {
    for (const child of list) {
      if (typeof child === "string" || typeof child === "number") {
        this.markdown(String(child), out);
      } else if (isNode(child)) {
        this.node(child, out);
      }
    }
  }

  private markdown(md: string, out: Out): void {
    if (md.trim() === "") return;
    out.html.push(markdownToHtml(md));
    out.text.push(md.trim());
  }

  private node(node: ChannelNode, out: Out): void {
    const p = node.props;
    switch (node.type) {
      case "message": {
        const inner: Out = { html: [], text: [] };
        this.nodes(children(node), inner);
        const accent =
          typeof p.accent === "string" && /^#[0-9a-f]{3,8}$/i.test(p.accent)
            ? p.accent
            : undefined;
        out.html.push(
          accent
            ? `<div style="border-left:4px solid ${accent};padding-left:12px">${inner.html.join("\n")}</div>`
            : inner.html.join("\n"),
        );
        out.text.push(...inner.text);
        return;
      }
      case "text":
      case "section":
      case "markdown":
        this.markdown(textOf(node.type === "text" ? [node] : p.children), out);
        return;
      case "header": {
        const text = textOf(p.children);
        if (!text) return;
        out.html.push(
          `<p style="margin:0 0 12px;font-size:20px;font-weight:600">${escapeHtml(text)}</p>`,
        );
        out.text.push(text);
        return;
      }
      case "fields":
        this.nodes(children(node), out);
        return;
      case "field": {
        const value = textOf(p.children);
        const label = typeof p.label === "string" ? p.label : undefined;
        out.html.push(
          `<p style="margin:0 0 8px">${label ? `<strong>${escapeHtml(label)}:</strong> ` : ""}${escapeHtml(value)}</p>`,
        );
        out.text.push(label ? `${label}: ${value}` : value);
        return;
      }
      case "context": {
        const text = textOf(p.children);
        if (!text) return;
        out.html.push(
          `<p style="margin:0 0 12px;font-size:12px;color:#57606a">${escapeHtml(text)}</p>`,
        );
        out.text.push(text);
        return;
      }
      case "divider":
        out.html.push(
          '<hr style="border:0;border-top:1px solid #d0d7de;margin:16px 0">',
        );
        out.text.push("----");
        return;
      case "image": {
        const url = typeof p.url === "string" ? safeUrl(p.url) : undefined;
        const alt = typeof p.alt === "string" ? p.alt : "";
        if (!url || url.startsWith("mailto:")) return;
        out.html.push(
          `<p style="margin:0 0 12px"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" style="max-width:100%;height:auto;border-radius:6px"></p>`,
        );
        out.text.push(alt ? `${alt}: ${url}` : url);
        return;
      }
      case "render": {
        // A <Render> snapshot needs an image host. Email shows its summary.
        const alt = typeof p.alt === "string" ? p.alt : "";
        if (alt) this.markdown(alt, out);
        return;
      }
      case "actions": {
        const inner: Out = { html: [], text: [] };
        this.nodes(children(node), inner);
        if (inner.html.length === 0) return;
        out.html.push(`<p style="margin:12px 0">${inner.html.join("")}</p>`);
        out.text.push(inner.text.join("\n"));
        return;
      }
      case "button":
        this.button(node, out);
        return;
      case "select":
        this.select(node, out);
        return;
      case "table":
        this.table(node, out);
        return;
      case "chart":
        this.chart(node, out);
        return;
      case "carousel":
      case "carouselCard":
        this.nodes(children(node), out);
        return;
      case "input":
      case "raw":
        // Email has no text input, and raw payloads belong to one provider.
        return;
      default:
        this.nodes(children(node), out);
    }
  }

  private button(node: ChannelNode, out: Out): void {
    const p = node.props;
    const label = textOf(p.children) || "Open";
    if (typeof p.url === "string" && p.url.length > 0) {
      const url = safeUrl(p.url);
      if (!url) {
        this.label(label, out);
        return;
      }
      out.html.push(
        `<a href="${escapeHtml(url)}" style="${SECONDARY_STYLE}">${escapeHtml(label)}</a>`,
      );
      out.text.push(`${label}: ${url}`);
      return;
    }
    const id = handlerId(p.onClick);
    const url = id
      ? this.opts.link?.({
          id,
          label,
          ...(p.value !== undefined ? { value: p.value } : {}),
        })
      : undefined;
    if (!url) {
      this.label(label, out);
      return;
    }
    const style = p.style === "danger" ? DANGER_STYLE : BUTTON_STYLE;
    out.html.push(
      `<a href="${escapeHtml(url)}" style="${style}">${escapeHtml(label)}</a>`,
    );
    out.text.push(`${label}: ${url}`);
  }

  /** A control that cannot be a link keeps its label. */
  private label(label: string, out: Out): void {
    out.html.push(`<span style="${LABEL_STYLE}">${escapeHtml(label)}</span>`);
    out.text.push(`[${label}]`);
  }

  private select(node: ChannelNode, out: Out): void {
    const p = node.props;
    const options = Array.isArray(p.options)
      ? (p.options as Array<{ label?: unknown; value?: unknown }>).filter(
          (o) => typeof o.label === "string" && typeof o.value === "string",
        )
      : [];
    if (options.length === 0) return;
    const id = handlerId(p.onSelect);
    const placeholder = typeof p.placeholder === "string" ? p.placeholder : "";
    if (placeholder) {
      out.html.push(
        `<p style="margin:12px 0 4px;font-weight:600">${escapeHtml(placeholder)}</p>`,
      );
      out.text.push(placeholder);
    }
    const inner: Out = { html: [], text: [] };
    for (const option of options) {
      const label = option.label as string;
      const url = id
        ? this.opts.link?.({ id, label, value: option.value })
        : undefined;
      if (url) {
        inner.html.push(
          `<a href="${escapeHtml(url)}" style="${SECONDARY_STYLE}">${escapeHtml(label)}</a>`,
        );
        inner.text.push(`- ${label}: ${url}`);
      } else {
        inner.html.push(
          `<span style="${LABEL_STYLE}">${escapeHtml(label)}</span>`,
        );
        inner.text.push(`- ${label}`);
      }
    }
    out.html.push(`<p style="margin:4px 0 12px">${inner.html.join("")}</p>`);
    out.text.push(inner.text.join("\n"));
  }

  private table(node: ChannelNode, out: Out): void {
    const columns = Array.isArray(node.props.columns)
      ? (node.props.columns as Array<{ header?: unknown }>).map((c) =>
          String(c.header ?? ""),
        )
      : [];
    const rows = children(node)
      .filter(isNode)
      .map((row) =>
        children(row)
          .filter(isNode)
          .map((cell) => textOf(cell.props.children)),
      );
    const head = columns.length
      ? `<tr>${columns.map((c) => `<th style="${CELL_STYLE};background:#f6f8fa">${escapeHtml(c)}</th>`).join("")}</tr>`
      : "";
    const body = rows
      .map(
        (cells) =>
          `<tr>${cells.map((c) => `<td style="${CELL_STYLE}">${escapeHtml(c)}</td>`).join("")}</tr>`,
      )
      .join("");
    out.html.push(
      `<table style="border-collapse:collapse;margin:0 0 12px">${head}${body}</table>`,
    );
    out.text.push(
      [columns.join(" | "), ...rows.map((r) => r.join(" | "))]
        .filter(Boolean)
        .join("\n"),
    );
  }

  /** Email cannot draw a chart. It shows the data as a table. */
  private chart(node: ChannelNode, out: Out): void {
    const p = node.props;
    const data = Array.isArray(p.data)
      ? (p.data as Array<{ label?: unknown; value?: unknown }>)
      : [];
    const title = typeof p.title === "string" ? p.title : "";
    if (title) {
      out.html.push(
        `<p style="margin:0 0 8px;font-weight:600">${escapeHtml(title)}</p>`,
      );
      out.text.push(title);
    }
    const rows = data.map((d) => [
      String(d.label ?? ""),
      String(d.value ?? ""),
    ]);
    out.html.push(
      `<table style="border-collapse:collapse;margin:0 0 12px">${rows
        .map(
          ([l, v]) =>
            `<tr><td style="${CELL_STYLE}">${escapeHtml(l!)}</td><td style="${CELL_STYLE};text-align:right">${escapeHtml(v!)}</td></tr>`,
        )
        .join("")}</table>`,
    );
    out.text.push(rows.map(([l, v]) => `${l}: ${v}`).join("\n"));
  }
}

/** Render channel IR to an HTML email and its plain-text alternative. */
export function renderEmail(
  ir: readonly ChannelNode[],
  opts: RenderOptions = {},
): EmailBody {
  return new EmailRenderer(opts).render(ir);
}

/** Wrap agent Markdown as an email body. */
export function markdownEmail(markdown: string): EmailBody {
  return {
    html: `<div style="${FONT}">\n${markdownToHtml(markdown)}\n</div>`,
    text: markdown.trim(),
  };
}

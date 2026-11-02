import {
  createStreamingMarkdownParserState,
  finalizeStreamingMarkdown,
  parseStreamingMarkdownChunk,
} from "@copilotkit/markdown-renderer";
import type { StreamingMarkdownAstNode } from "@copilotkit/markdown-renderer";

/** Inspector policy the HTML renderer applies to URLs and code blocks. */
export type MarkdownHtmlOptions = Readonly<{
  /** The href to emit for a link or autolink. Return "#" to neuter it. */
  linkHref: (url: string) => string;
  /** The src to emit for an image, or null to render its alt text instead. */
  imageSrc: (url: string) => string | null;
  /** The `data-copy` payload for a code block's Copy button. */
  copyPayload: (code: string) => string;
}>;

type MarkdownNode = StreamingMarkdownAstNode;
type NodeOfType<T extends MarkdownNode["type"]> = Extract<
  MarkdownNode,
  { type: T }
>;

type RenderContext = Readonly<{
  nodes: ReadonlyMap<number, MarkdownNode>;
  /** Normalized Markdown source; node ranges index into it. */
  source: string;
  options: MarkdownHtmlOptions;
}>;

const ESCAPED: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape every markup-significant character (attributes, code). */
function escapeAll(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPED[char]!);
}

/**
 * Escape prose text but leave existing character references such as `&amp;`
 * or `&copy;` alone, as Markdown (and the previous marked renderer) does. A
 * character reference cannot open a tag, so this does not weaken escaping.
 */
function escapeText(value: string): string {
  return value.replace(
    /[<>"']|&(?!#\d{1,7};|#[Xx][a-fA-F0-9]{1,6};|\w+;)/g,
    (char) => ESCAPED[char]!,
  );
}

/**
 * Render a complete Markdown document to an HTML string for the What's new
 * article. The output is meant for `unsafeHTML`, so every piece of source text
 * is escaped: raw HTML in the Markdown renders as visible text, and URLs only
 * reach attributes through the caller's `linkHref` / `imageSrc` policy.
 */
export function renderMarkdownToHtml(
  markdown: string,
  options: MarkdownHtmlOptions,
): string {
  const state = finalizeStreamingMarkdown(
    parseStreamingMarkdownChunk(
      createStreamingMarkdownParserState({ segmenter: false }),
      markdown,
    ),
  );
  const nodes = new Map(state.nodes.map((node) => [node.id, node]));
  const root = state.rootId === null ? undefined : nodes.get(state.rootId);
  if (!root || root.type !== "document") return "";
  return renderChildren(root.children, {
    nodes,
    source: state.source,
    options,
  });
}

function childNodes(ids: readonly number[], context: RenderContext) {
  return ids.flatMap((id) => {
    const node = context.nodes.get(id);
    return node ? [node] : [];
  });
}

function renderChildren(
  ids: readonly number[],
  context: RenderContext,
): string {
  return childNodes(ids, context)
    .map((node) => renderNode(node, context))
    .join("");
}

function renderNode(node: MarkdownNode, context: RenderContext): string {
  switch (node.type) {
    case "document":
    case "table-row":
    case "table-cell":
      return renderChildren(node.children, context);
    case "paragraph":
      return `<p>${renderChildren(node.children, context)}</p>\n`;
    case "heading":
      return `<h${node.level}>${renderChildren(node.children, context)}</h${node.level}>\n`;
    case "blockquote":
      return `<blockquote>\n${renderChildren(node.children, context)}</blockquote>\n`;
    case "list":
      return renderList(node, context);
    case "list-item":
      return `<li>${renderChildren(node.children, context)}</li>\n`;
    case "code-block":
      return renderCodeBlock(node, context);
    case "table":
      return renderTable(node, context);
    case "thematic-break":
      return "<hr>\n";
    case "text":
      return escapeText(node.text);
    case "em":
      return `<em>${renderChildren(node.children, context)}</em>`;
    case "strong":
      return `<strong>${renderChildren(node.children, context)}</strong>`;
    case "strikethrough":
      return `<del>${renderChildren(node.children, context)}</del>`;
    case "inline-code":
      return `<code>${escapeAll(node.text)}</code>`;
    case "soft-break":
      return "\n";
    case "hard-break":
      return "<br>";
    case "link":
      return renderLink(
        node.url,
        node.title,
        renderChildren(node.children, context),
        context,
      );
    case "autolink":
      return renderLink(node.url, undefined, escapeText(node.text), context);
    case "image":
      return renderImage(node, context);
    case "citation":
      // The article has no footnotes; show the reference as it was typed.
      return escapeText(`[^${node.idRef}]`);
    default: {
      const unhandled: never = node;
      return unhandled;
    }
  }
}

/** A piece of list item content: one authored paragraph, or another block. */
type ItemPart =
  | { kind: "paragraph"; nodes: MarkdownNode[] }
  | { kind: "block"; node: MarkdownNode };

/**
 * The parser keeps each list item as a single paragraph, so a blank line
 * inside an item survives only as two soft breaks in a row. Split there to
 * recover the paragraphs the author wrote.
 */
function itemParts(
  item: NodeOfType<"list-item">,
  context: RenderContext,
): ItemPart[] {
  return childNodes(item.children, context).flatMap((block): ItemPart[] =>
    block.type === "paragraph"
      ? splitAtBlankLines(childNodes(block.children, context)).map((nodes) => ({
          kind: "paragraph",
          nodes,
        }))
      : [{ kind: "block", node: block }],
  );
}

function splitAtBlankLines(nodes: readonly MarkdownNode[]): MarkdownNode[][] {
  const paragraphs: MarkdownNode[][] = [[]];
  let breaks: MarkdownNode[] = [];
  for (const node of nodes) {
    const isBlankText = node.type === "text" && node.text.trim() === "";
    if (node.type === "soft-break" || (breaks.length > 0 && isBlankText)) {
      breaks.push(node);
      continue;
    }
    const current = paragraphs[paragraphs.length - 1]!;
    if (breaks.filter((n) => n.type === "soft-break").length >= 2) {
      paragraphs.push([node]);
    } else {
      current.push(...breaks, node);
    }
    breaks = [];
  }
  return paragraphs.filter((paragraph) => paragraph.length > 0);
}

/**
 * A list is loose when a blank line separates two of its items or two
 * paragraphs inside one item. The blank line that ends the list does not
 * count, so a list followed by more prose still renders tight.
 */
function isLooseList(
  items: readonly NodeOfType<"list-item">[],
  parts: readonly ItemPart[][],
  context: RenderContext,
): boolean {
  const hasSplitItem = parts.some(
    (item) => item.filter((part) => part.kind === "paragraph").length > 1,
  );
  return (
    hasSplitItem ||
    items.slice(0, -1).some((item, index) => {
      const between = context.source.slice(
        item.range.start,
        items[index + 1]!.range.start,
      );
      return /\n[ \t]*\n/.test(between);
    })
  );
}

const TASK_MARKER = /^\[([ xX])\][ \t]+/;

/** Render inline nodes, turning a leading `[ ]` / `[x]` into a checkbox. */
function renderTaskAwareInline(
  nodes: readonly MarkdownNode[],
  context: RenderContext,
): string {
  const [first, ...rest] = nodes;
  const task = first?.type === "text" ? TASK_MARKER.exec(first.text) : null;
  if (!first || first.type !== "text" || !task) {
    return nodes.map((node) => renderNode(node, context)).join("");
  }
  const checked = task[1] === " " ? "" : 'checked="" ';
  const label = escapeText(first.text.slice(task[0].length));
  const tail = rest.map((node) => renderNode(node, context)).join("");
  return `<input ${checked}disabled="" type="checkbox"> ${label}${tail}`;
}

function renderList(node: NodeOfType<"list">, context: RenderContext): string {
  const tag = node.ordered ? "ol" : "ul";
  const start =
    node.ordered && node.start !== null && node.start !== 1
      ? ` start="${node.start}"`
      : "";
  const items = childNodes(node.children, context).filter(
    (item): item is NodeOfType<"list-item"> => item.type === "list-item",
  );
  const parts = items.map((item) => itemParts(item, context));
  const loose = isLooseList(items, parts, context);
  const body = parts
    .map((itemContent) => {
      const content = itemContent
        .map((part, index) => {
          if (part.kind === "block") return renderNode(part.node, context);
          const inline =
            index === 0
              ? renderTaskAwareInline(part.nodes, context)
              : part.nodes.map((n) => renderNode(n, context)).join("");
          return loose ? `<p>${inline}</p>\n` : inline;
        })
        .join("");
      return `<li>${content}</li>\n`;
    })
    .join("");
  return `<${tag}${start}>\n${body}</${tag}>\n`;
}

function renderCodeBlock(
  node: NodeOfType<"code-block">,
  context: RenderContext,
): string {
  const language = (node.info ?? "").replace(/[^a-z0-9-]/gi, "");
  const languageClass = language ? ` class="language-${language}"` : "";
  const payload = escapeAll(context.options.copyPayload(node.text));
  return `<div class="announcement-code"><pre><code${languageClass}>${escapeAll(node.text)}</code></pre><div class="announcement-code__copy-shield"><button type="button" class="announcement-code__copy" data-copy="${payload}" aria-label="Copy code">Copy</button></div></div>`;
}

function renderTable(
  node: NodeOfType<"table">,
  context: RenderContext,
): string {
  const rows = childNodes(node.children, context).filter(
    (row): row is NodeOfType<"table-row"> => row.type === "table-row",
  );
  const renderRow = (row: NodeOfType<"table-row">) => {
    const tag = row.isHeader ? "th" : "td";
    const cells = childNodes(row.children, context)
      .map((cell, index) => {
        const align = node.align[index];
        const alignAttr = align && align !== "none" ? ` align="${align}"` : "";
        return `<${tag}${alignAttr}>${renderNode(cell, context)}</${tag}>\n`;
      })
      .join("");
    return `<tr>\n${cells}</tr>\n`;
  };
  const header = rows.filter((row) => row.isHeader).map(renderRow);
  const body = rows.filter((row) => !row.isHeader).map(renderRow);
  return `<table>\n<thead>\n${header.join("")}</thead>\n${
    body.length > 0 ? `<tbody>${body.join("")}</tbody>` : ""
  }</table>\n`;
}

function renderImage(
  node: NodeOfType<"image">,
  context: RenderContext,
): string {
  const src = context.options.imageSrc(node.url);
  if (src === null) return escapeText(node.alt);
  const title = node.title ? ` title="${escapeAll(node.title)}"` : "";
  return `<img src="${escapeAll(src)}" alt="${escapeAll(node.alt)}"${title}>`;
}

function renderLink(
  url: string,
  title: string | undefined,
  content: string,
  context: RenderContext,
): string {
  const href = escapeAll(context.options.linkHref(url));
  const titleAttr = title ? ` title="${escapeAll(title)}"` : "";
  return `<a href="${href}" target="_blank" rel="noopener"${titleAttr}>${content}</a>`;
}

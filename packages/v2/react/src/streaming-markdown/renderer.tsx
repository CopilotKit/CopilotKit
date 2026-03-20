// Derived from hashbrown/packages/react/src/magic-text-renderer.tsx
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

/**
 * React renderer for the streaming markdown block tree.
 *
 * Walks the block tree produced by the streaming markdown parser and
 * renders React elements with stable keys (using block IDs). This
 * ensures minimal DOM churn during streaming.
 */

import React from "react";
import type {
  Block,
  HeadingBlock,
  ParagraphBlock,
  CodeFenceBlock,
  BlockquoteBlock,
  OrderedListBlock,
  UnorderedListBlock,
  TableBlock,
  ThematicBreakBlock,
  ListItemBlock,
  InlineSegment,
  TextSegment,
  BoldSegment,
  ItalicSegment,
  CodeSegment,
  StrikethroughSegment,
  LinkSegment,
  ImageSegment,
  TableAlignment,
} from "@copilotkitnext/core";

// ─── Public API ────────────────────────────────────────────────

export interface MagicTextRendererProps {
  /** The block tree from the parser */
  blocks: Block[];
  /** Optional className for the wrapper */
  className?: string;
}

/**
 * Render a streaming markdown block tree into React elements.
 *
 * Each block is keyed by its stable ID, so React can efficiently
 * update the DOM as new blocks stream in.
 */
export function MagicTextRenderer({
  blocks,
  className,
}: MagicTextRendererProps): React.ReactElement {
  return React.createElement(
    "div",
    { className },
    blocks.map((block) => renderBlock(block)),
  );
}

// ─── Block renderers ───────────────────────────────────────────

function renderBlock(block: Block): React.ReactElement {
  switch (block.type) {
    case "heading":
      return renderHeading(block);
    case "paragraph":
      return renderParagraph(block);
    case "code_fence":
      return renderCodeFence(block);
    case "blockquote":
      return renderBlockquote(block);
    case "ordered_list":
      return renderOrderedList(block);
    case "unordered_list":
      return renderUnorderedList(block);
    case "table":
      return renderTable(block);
    case "thematic_break":
      return renderThematicBreak(block);
  }
}

function renderHeading(block: HeadingBlock): React.ReactElement {
  const tag = `h${block.level}` as keyof JSX.IntrinsicElements;
  return React.createElement(
    tag,
    { key: `block-${block.id}` },
    renderInlineSegments(block.inline, block.id),
  );
}

function renderParagraph(block: ParagraphBlock): React.ReactElement {
  return React.createElement(
    "p",
    { key: `block-${block.id}` },
    renderInlineSegments(block.inline, block.id),
  );
}

function renderCodeFence(block: CodeFenceBlock): React.ReactElement {
  const codeElement = React.createElement(
    "code",
    block.language
      ? { className: `language-${block.language}` }
      : undefined,
    block.content,
  );
  return React.createElement("pre", { key: `block-${block.id}` }, codeElement);
}

function renderBlockquote(block: BlockquoteBlock): React.ReactElement {
  return React.createElement(
    "blockquote",
    { key: `block-${block.id}` },
    block.children.map((child) => renderBlock(child)),
  );
}

function renderOrderedList(block: OrderedListBlock): React.ReactElement {
  return React.createElement(
    "ol",
    {
      key: `block-${block.id}`,
      start: block.start !== 1 ? block.start : undefined,
    },
    block.items.map((item) => renderListItem(item)),
  );
}

function renderUnorderedList(block: UnorderedListBlock): React.ReactElement {
  return React.createElement(
    "ul",
    { key: `block-${block.id}` },
    block.items.map((item) => renderListItem(item)),
  );
}

function renderListItem(item: ListItemBlock): React.ReactElement {
  const children: React.ReactNode[] = renderInlineSegments(
    item.inline,
    item.id,
  );
  if (item.children.length > 0) {
    children.push(
      ...item.children.map((child) => renderBlock(child)),
    );
  }
  return React.createElement("li", { key: `item-${item.id}` }, children);
}

function renderTable(block: TableBlock): React.ReactElement {
  const headerCells = block.headers.map((header, i) =>
    React.createElement(
      "th",
      {
        key: `th-${block.id}-${i}`,
        style: getAlignmentStyle(block.alignments[i]),
      },
      renderInlineSegments(header.inline, block.id * 1000 + i),
    ),
  );

  const thead = React.createElement(
    "thead",
    null,
    React.createElement("tr", null, headerCells),
  );

  const rows = block.rows.map((row, rowIdx) => {
    const cells = row.map((cell, cellIdx) =>
      React.createElement(
        "td",
        {
          key: `td-${block.id}-${rowIdx}-${cellIdx}`,
          style: getAlignmentStyle(block.alignments[cellIdx]),
        },
        renderInlineSegments(
          cell.inline,
          block.id * 1000000 + rowIdx * 1000 + cellIdx,
        ),
      ),
    );
    return React.createElement("tr", { key: `tr-${block.id}-${rowIdx}` }, cells);
  });

  const tbody =
    rows.length > 0 ? React.createElement("tbody", null, rows) : null;

  return React.createElement(
    "table",
    { key: `block-${block.id}` },
    thead,
    tbody,
  );
}

function renderThematicBreak(block: ThematicBreakBlock): React.ReactElement {
  return React.createElement("hr", { key: `block-${block.id}` });
}

// ─── Inline renderers ──────────────────────────────────────────

function renderInlineSegments(
  segments: InlineSegment[],
  parentId: number,
): React.ReactNode[] {
  return segments.map((seg, i) => renderInlineSegment(seg, `${parentId}-${i}`));
}

function renderInlineSegment(
  segment: InlineSegment,
  keyPrefix: string,
): React.ReactNode {
  switch (segment.type) {
    case "text":
      return (segment as TextSegment).content;
    case "bold":
      return React.createElement(
        "strong",
        { key: `bold-${keyPrefix}` },
        renderInlineChildren((segment as BoldSegment).children, keyPrefix),
      );
    case "italic":
      return React.createElement(
        "em",
        { key: `italic-${keyPrefix}` },
        renderInlineChildren((segment as ItalicSegment).children, keyPrefix),
      );
    case "code":
      return React.createElement(
        "code",
        { key: `code-${keyPrefix}` },
        (segment as CodeSegment).content,
      );
    case "strikethrough":
      return React.createElement(
        "del",
        { key: `del-${keyPrefix}` },
        renderInlineChildren(
          (segment as StrikethroughSegment).children,
          keyPrefix,
        ),
      );
    case "link":
      return React.createElement(
        "a",
        {
          key: `link-${keyPrefix}`,
          href: (segment as LinkSegment).href,
        },
        renderInlineChildren((segment as LinkSegment).children, keyPrefix),
      );
    case "image":
      return React.createElement("img", {
        key: `img-${keyPrefix}`,
        src: (segment as ImageSegment).src,
        alt: (segment as ImageSegment).alt,
      });
  }
}

function renderInlineChildren(
  children: InlineSegment[],
  keyPrefix: string,
): React.ReactNode[] {
  return children.map((child, i) =>
    renderInlineSegment(child, `${keyPrefix}-${i}`),
  );
}

// ─── Helpers ───────────────────────────────────────────────────

function getAlignmentStyle(
  alignment: TableAlignment | undefined,
): React.CSSProperties | undefined {
  if (!alignment || alignment === "none") return undefined;
  return { textAlign: alignment };
}

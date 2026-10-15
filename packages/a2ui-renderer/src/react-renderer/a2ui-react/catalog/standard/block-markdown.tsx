import React from "react";
import { renderInlineMarkdown } from "./inline-markdown";

/**
 * Dependency-free block-level markdown for the `Markdown` component when the
 * host provides no renderer. Covers what a model puts next to components:
 * headings, paragraphs, bullet and numbered lists, block quotes, fenced code
 * and horizontal rules, with `renderInlineMarkdown` for the inline marks.
 * Anything else renders as a paragraph of its literal text.
 */

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string; language?: string }
  | { kind: "rule" };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*```\s*(\S*)\s*$/;

export function parseBlockMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  const flushParagraph = (buf: string[]) => {
    if (buf.length) blocks.push({ kind: "paragraph", text: buf.join(" ") });
    buf.length = 0;
  };
  const paragraph: string[] = [];
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph(paragraph);
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) code.push(lines[i++]!);
      i++; // closing fence (or end of input)
      blocks.push({
        kind: "code",
        text: code.join("\n"),
        ...(fence[1] ? { language: fence[1] } : {}),
      });
      continue;
    }
    if (line.trim() === "") {
      flushParagraph(paragraph);
      i++;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph(paragraph);
      blocks.push({
        kind: "heading",
        level: heading[1]!.length,
        text: heading[2]!,
      });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      flushParagraph(paragraph);
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }
    const listMatch = (l: string) => BULLET.exec(l) ?? NUMBERED.exec(l);
    if (listMatch(line)) {
      flushParagraph(paragraph);
      const ordered = NUMBERED.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const m = listMatch(lines[i]!);
        if (!m || NUMBERED.test(lines[i]!) !== ordered) break;
        items.push(m[1]!);
        i++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (QUOTE.test(line)) {
      flushParagraph(paragraph);
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        quoted.push(QUOTE.exec(lines[i]!)![1]!);
        i++;
      }
      blocks.push({ kind: "quote", text: quoted.join(" ") });
      continue;
    }
    paragraph.push(line.trim());
    i++;
  }
  flushParagraph(paragraph);
  return blocks;
}

export function renderBlockMarkdown(source: string): React.ReactNode {
  return parseBlockMarkdown(source).map((block, key) => {
    switch (block.kind) {
      case "heading": {
        const Tag = `h${block.level}` as "h1";
        return <Tag key={key}>{renderInlineMarkdown(block.text)}</Tag>;
      }
      case "paragraph":
        return <p key={key}>{renderInlineMarkdown(block.text)}</p>;
      case "list": {
        const Tag = block.ordered ? "ol" : "ul";
        return (
          <Tag key={key}>
            {block.items.map((item, k) => (
              <li key={k}>{renderInlineMarkdown(item)}</li>
            ))}
          </Tag>
        );
      }
      case "quote":
        return (
          <blockquote key={key}>{renderInlineMarkdown(block.text)}</blockquote>
        );
      case "code":
        return (
          <pre key={key}>
            <code data-language={block.language}>{block.text}</code>
          </pre>
        );
      case "rule":
        return <hr key={key} />;
    }
  });
}

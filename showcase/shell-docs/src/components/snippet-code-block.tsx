"use client";

import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import type { ShikiTransformer } from "shiki";

interface SnippetCodeBlockProps {
  lang: string;
  code: string;
  caption?: string;
  highlightLines?: string;
}

function parseLineRange(input: string | undefined): [number, number] | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;

  const openEnded = trimmed.match(/^(\d+)\s*[-\u2013]\s*$/);
  if (openEnded) {
    const start = parseInt(openEnded[1], 10);
    if (start > 0) return [start, Number.POSITIVE_INFINITY];
    return null;
  }

  const dash = trimmed.match(/^(\d+)\s*[-\u2013]\s*(\d+)$/);
  if (dash) {
    const start = parseInt(dash[1], 10);
    const end = parseInt(dash[2], 10);
    if (start > 0 && end >= start) return [start, end];
    return null;
  }

  const single = trimmed.match(/^(\d+)$/);
  if (single) {
    const n = parseInt(single[1], 10);
    if (n > 0) return [n, n];
  }

  return null;
}

function parseLineSet(input: string | undefined, code: string): Set<number> {
  const highlighted = new Set<number>();
  if (!input?.trim()) return highlighted;

  const lineCount = code.split("\n").length;
  for (const part of input.split(",")) {
    const range = parseLineRange(part.trim());
    if (!range) {
      console.warn(
        `[snippet] invalid highlightLines="${input}" - expected comma-separated line ranges like "1,4-6".`,
      );
      return new Set();
    }

    const [start, rawEnd] = range;
    if (start > lineCount) continue;

    const end = Math.min(rawEnd, lineCount);
    for (let line = start; line <= end; line++) highlighted.add(line);
  }

  return highlighted;
}

function createLineHighlightTransformer(lines: Set<number>): ShikiTransformer {
  return {
    name: "copilotkit-docs-snippet-highlight-lines",
    line(hast, line) {
      if (lines.has(line)) {
        this.addClassToHast(hast, "highlighted");
      }
    },
  };
}

export function SnippetCodeBlock({
  lang,
  code,
  caption,
  highlightLines,
}: SnippetCodeBlockProps) {
  const highlightedLines = parseLineSet(highlightLines, code);
  const highlightOptions =
    highlightedLines.size > 0
      ? {
          options: {
            themes: {
              light: "github-light",
              dark: "github-dark",
            },
            transformers: [createLineHighlightTransformer(highlightedLines)],
          },
        }
      : {};

  return (
    <DynamicCodeBlock
      lang={lang}
      code={code}
      codeblock={caption ? { title: caption } : undefined}
      {...highlightOptions}
    />
  );
}

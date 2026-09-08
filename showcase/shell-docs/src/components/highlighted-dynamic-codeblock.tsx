"use client";

import React from "react";
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import type { CodeBlockProps } from "fumadocs-ui/components/codeblock";
import type { ShikiTransformer } from "shiki";

interface HighlightedDynamicCodeBlockProps {
  lang: string;
  code: string;
  codeblock?: CodeBlockProps;
  highlightedLines?: number[];
}

function lineHighlightTransformer(
  highlightedLines: readonly number[],
): ShikiTransformer {
  const highlighted = new Set(highlightedLines);

  return {
    name: "shell-docs:snippet-line-highlight",
    pre(hast) {
      this.addClassToHast(hast, "has-highlighted");
    },
    line(hast, line) {
      if (highlighted.has(line)) {
        this.addClassToHast(hast, "highlighted");
      }
    },
  };
}

export function HighlightedDynamicCodeBlock({
  lang,
  code,
  codeblock,
  highlightedLines,
}: HighlightedDynamicCodeBlockProps) {
  const options = React.useMemo(
    () => ({
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      transformers:
        highlightedLines && highlightedLines.length > 0
          ? [lineHighlightTransformer(highlightedLines)]
          : undefined,
    }),
    [highlightedLines],
  );

  return (
    <DynamicCodeBlock
      lang={lang}
      code={code}
      codeblock={codeblock}
      options={options}
    />
  );
}

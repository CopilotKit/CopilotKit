"use client";

import { useEffect, useState } from "react";
import type { HighlighterCore, ThemedToken } from "shiki/core";
import type { DiffHunk } from "./diff";
import { useTheme } from "./theme";

/**
 * Syntax colors for diff lines. Shiki loads lazily with only the grammars this
 * app needs and the JavaScript regex engine (no WASM).
 */

const THEMES = {
  dark: "github-dark-default",
  light: "github-light-default",
} as const;

let highlighter: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] =
      await Promise.all([
        import("shiki/core"),
        import("shiki/engine/javascript"),
      ]);
    return createHighlighterCore({
      themes: [
        import("shiki/themes/github-dark-default.mjs"),
        import("shiki/themes/github-light-default.mjs"),
      ],
      langs: [
        import("shiki/langs/python.mjs"),
        import("shiki/langs/typescript.mjs"),
        import("shiki/langs/tsx.mjs"),
        import("shiki/langs/javascript.mjs"),
        import("shiki/langs/json.mjs"),
        import("shiki/langs/yaml.mjs"),
        import("shiki/langs/toml.mjs"),
        import("shiki/langs/bash.mjs"),
        import("shiki/langs/markdown.mjs"),
      ],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return highlighter;
}

export type TokenLine = Pick<ThemedToken, "content" | "color">[];

/**
 * Tokens for every line of every hunk, aligned with `hunk.lines`. Old and new
 * sides are tokenized as two continuous texts so multi-line constructs (strings,
 * docstrings) color correctly, then mapped back line by line.
 */
export function useHighlightedHunks(
  hunks: DiffHunk[],
  lang: string | null,
): TokenLine[][] | null {
  // Tokens remember the hunks they were computed for, so a change of hunks
  // never shows the previous diff's colors on the new lines.
  const { theme } = useTheme();
  const shikiTheme = THEMES[theme];
  const [tokens, setTokens] = useState<{
    for: DiffHunk[];
    theme: string;
    lines: TokenLine[][];
  } | null>(null);

  useEffect(() => {
    if (!lang) return;
    let cancelled = false;
    getHighlighter()
      .then((hl) => {
        const result = hunks.map((hunk) => {
          const oldSide = hunk.lines
            .filter((l) => l.kind !== "add")
            .map((l) => l.text);
          const newSide = hunk.lines
            .filter((l) => l.kind !== "del")
            .map((l) => l.text);
          const oldTokens = hl.codeToTokensBase(oldSide.join("\n"), {
            lang,
            theme: shikiTheme,
          });
          const newTokens = hl.codeToTokensBase(newSide.join("\n"), {
            lang,
            theme: shikiTheme,
          });
          let o = 0;
          let n = 0;
          return hunk.lines.map((line) => {
            if (line.kind === "del") return oldTokens[o++] ?? [];
            if (line.kind === "add") return newTokens[n++] ?? [];
            o++;
            return newTokens[n++] ?? [];
          });
        });
        if (!cancelled)
          setTokens({ for: hunks, theme: shikiTheme, lines: result });
      })
      .catch((error: unknown) => {
        // Plain text is a fine fallback; colors are an enhancement.
        console.warn("Syntax highlighting unavailable:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [hunks, lang, shikiTheme]);

  return lang && tokens?.for === hunks && tokens.theme === shikiTheme
    ? tokens.lines
    : null;
}

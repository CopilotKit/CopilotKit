import React from "react";
import { Lexer } from "marked";
import type { Token } from "marked";

/** Render only emphasis as elements; HTML, links, images, and other syntax stay literal. */
function renderInline(tokens: Token[]): React.ReactNode {
  return tokens.map(
    /** Map inline tokens to emphasis nodes while preserving unsupported syntax as text. */
    (token, index) => {
      switch (token.type) {
        case "strong":
          return <strong key={index}>{renderInline(token.tokens)}</strong>;
        case "em":
          return <em key={index}>{renderInline(token.tokens)}</em>;
        case "text":
          return "tokens" in token && token.tokens
            ? renderInline(token.tokens)
            : token.raw;
        case "escape":
          return token.raw.slice(1);
        default:
          return token.raw;
      }
    },
  );
}

/**
 * Parse native body Text into safe React nodes for headings, paragraphs, and emphasis.
 * A single paragraph keeps the existing inline host; block content requires a div.
 * Unsupported syntax is literal text, so no HTML or resource-loading elements are created.
 */
export function renderNativeTextMarkdown(text: string): {
  block: boolean;
  children: React.ReactNode;
} {
  const tokens = Lexer.lex(text, { gfm: false });
  if (tokens.length === 1 && tokens[0].type === "paragraph") {
    return { block: false, children: renderInline(tokens[0].tokens) };
  }
  return {
    block: tokens.some(
      /** Detect Markdown blocks that need a block-level host instead of an inline span. */
      (token) => token.type === "heading" || token.type === "paragraph",
    ),
    children: tokens.map(
      /** Build supported block elements and retain all other token source literally. */
      (token, index) => {
        switch (token.type) {
          case "heading":
            return React.createElement(
              `h${token.depth}`,
              { key: index },
              renderInline(token.tokens),
            );
          case "paragraph":
            return <p key={index}>{renderInline(token.tokens)}</p>;
          default:
            return token.raw;
        }
      },
    ),
  };
}

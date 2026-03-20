// Derived from hashbrown/packages/core/src/magic-text/inline-parser.ts
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

/**
 * Inline formatting parser for streaming markdown.
 *
 * Parses bold, italic, code, links, images, and strikethrough
 * from a line of text into an array of inline segments.
 */

export type InlineSegment =
  | TextSegment
  | BoldSegment
  | ItalicSegment
  | CodeSegment
  | StrikethroughSegment
  | LinkSegment
  | ImageSegment;

export interface TextSegment {
  type: "text";
  content: string;
}

export interface BoldSegment {
  type: "bold";
  children: InlineSegment[];
}

export interface ItalicSegment {
  type: "italic";
  children: InlineSegment[];
}

export interface CodeSegment {
  type: "code";
  content: string;
}

export interface StrikethroughSegment {
  type: "strikethrough";
  children: InlineSegment[];
}

export interface LinkSegment {
  type: "link";
  href: string;
  children: InlineSegment[];
}

export interface ImageSegment {
  type: "image";
  src: string;
  alt: string;
}

/**
 * Parse inline markdown formatting from a string.
 *
 * Handles: **bold**, *italic*, __bold__, _italic_, `code`,
 * ~~strikethrough~~, [links](url), ![images](url)
 */
export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let i = 0;
  let currentText = "";

  function flushText() {
    if (currentText.length > 0) {
      segments.push({ type: "text", content: currentText });
      currentText = "";
    }
  }

  while (i < text.length) {
    // Escape sequences
    if (text[i] === "\\" && i + 1 < text.length) {
      currentText += text[i + 1];
      i += 2;
      continue;
    }

    // Inline code (backtick)
    if (text[i] === "`") {
      const codeResult = tryParseInlineCode(text, i);
      if (codeResult) {
        flushText();
        segments.push(codeResult.segment);
        i = codeResult.end;
        continue;
      }
    }

    // Image: ![alt](src)
    if (text[i] === "!" && text[i + 1] === "[") {
      const imageResult = tryParseImage(text, i);
      if (imageResult) {
        flushText();
        segments.push(imageResult.segment);
        i = imageResult.end;
        continue;
      }
    }

    // Link: [text](url)
    if (text[i] === "[") {
      const linkResult = tryParseLink(text, i);
      if (linkResult) {
        flushText();
        segments.push(linkResult.segment);
        i = linkResult.end;
        continue;
      }
    }

    // Strikethrough: ~~text~~
    if (text[i] === "~" && text[i + 1] === "~") {
      const strikeResult = tryParseDelimited(text, i, "~~", "strikethrough");
      if (strikeResult) {
        flushText();
        segments.push(strikeResult.segment);
        i = strikeResult.end;
        continue;
      }
    }

    // Bold: **text** or __text__
    if (
      (text[i] === "*" && text[i + 1] === "*") ||
      (text[i] === "_" && text[i + 1] === "_")
    ) {
      const delimiter = text.substring(i, i + 2);
      const boldResult = tryParseDelimited(text, i, delimiter, "bold");
      if (boldResult) {
        flushText();
        segments.push(boldResult.segment);
        i = boldResult.end;
        continue;
      }
      // If bold parsing failed, emit both characters as text and skip
      // to avoid the italic parser misinterpreting the second char
      currentText += text[i];
      currentText += text[i + 1];
      i += 2;
      continue;
    }

    // Italic: *text* or _text_
    if (text[i] === "*" || text[i] === "_") {
      const delimiter = text[i];
      // Don't parse _ in the middle of a word
      if (
        delimiter === "_" &&
        i > 0 &&
        isWordChar(text[i - 1]) &&
        i + 1 < text.length &&
        isWordChar(text[i + 1])
      ) {
        currentText += text[i];
        i++;
        continue;
      }
      const italicResult = tryParseDelimited(text, i, delimiter, "italic");
      if (italicResult) {
        flushText();
        segments.push(italicResult.segment);
        i = italicResult.end;
        continue;
      }
    }

    currentText += text[i];
    i++;
  }

  flushText();
  return segments;
}

function isWordChar(ch: string): boolean {
  return /\w/.test(ch);
}

interface ParseResult<T> {
  segment: T;
  end: number;
}

function tryParseInlineCode(
  text: string,
  start: number,
): ParseResult<CodeSegment> | null {
  // Count opening backticks
  let backtickCount = 0;
  let i = start;
  while (i < text.length && text[i] === "`") {
    backtickCount++;
    i++;
  }

  // Find matching closing backticks
  const closingPattern = "`".repeat(backtickCount);
  const closingIndex = text.indexOf(closingPattern, i);
  if (closingIndex === -1) return null;

  // Ensure we have exactly the right number of backticks at the close
  // (not more)
  if (
    backtickCount > 1 &&
    closingIndex + backtickCount < text.length &&
    text[closingIndex + backtickCount] === "`"
  ) {
    return null;
  }

  let content = text.substring(i, closingIndex);
  // Strip one leading and one trailing space if both are present
  // (standard markdown behavior for code spans)
  if (
    content.length >= 2 &&
    content[0] === " " &&
    content[content.length - 1] === " "
  ) {
    content = content.substring(1, content.length - 1);
  }

  return {
    segment: { type: "code", content },
    end: closingIndex + backtickCount,
  };
}

function tryParseImage(
  text: string,
  start: number,
): ParseResult<ImageSegment> | null {
  // Must start with ![
  if (text[start] !== "!" || text[start + 1] !== "[") return null;

  const closeBracket = findClosingBracket(text, start + 1);
  if (closeBracket === -1) return null;

  const alt = text.substring(start + 2, closeBracket);

  // Must be followed by (
  if (text[closeBracket + 1] !== "(") return null;

  const closeParen = findClosingParen(text, closeBracket + 1);
  if (closeParen === -1) return null;

  const src = text.substring(closeBracket + 2, closeParen).trim();

  return {
    segment: { type: "image", alt, src },
    end: closeParen + 1,
  };
}

function tryParseLink(
  text: string,
  start: number,
): ParseResult<LinkSegment> | null {
  const closeBracket = findClosingBracket(text, start);
  if (closeBracket === -1) return null;

  // Must be followed by (
  if (text[closeBracket + 1] !== "(") return null;

  const closeParen = findClosingParen(text, closeBracket + 1);
  if (closeParen === -1) return null;

  const linkText = text.substring(start + 1, closeBracket);
  const href = text.substring(closeBracket + 2, closeParen).trim();
  const children = parseInline(linkText);

  return {
    segment: { type: "link", href, children },
    end: closeParen + 1,
  };
}

function tryParseDelimited(
  text: string,
  start: number,
  delimiter: string,
  type: "bold" | "italic" | "strikethrough",
): ParseResult<BoldSegment | ItalicSegment | StrikethroughSegment> | null {
  const delimLen = delimiter.length;
  const afterOpen = start + delimLen;

  // Must have content after delimiter
  if (afterOpen >= text.length) return null;
  // Content must not start with whitespace
  if (text[afterOpen] === " ") return null;

  const delimChar = delimiter[0];

  // Search for closing delimiter
  let i = afterOpen;
  while (i < text.length) {
    // Escape character
    if (text[i] === "\\" && i + 1 < text.length) {
      i += 2;
      continue;
    }

    // For single-char delimiters (* or _), when we encounter a double
    // delimiter (**), try to skip over the matched ** pair to handle
    // nested bold-inside-italic correctly (e.g. *text **bold** text*)
    if (delimLen === 1 && text[i] === delimChar && text[i + 1] === delimChar) {
      // This is a double-delimiter opening. Find its matching close.
      const doubleDelim = delimiter + delimiter;
      const closeIdx = findMatchingClose(text, i + 2, doubleDelim);
      if (closeIdx !== -1) {
        // Skip over the entire **...**  block
        i = closeIdx + 2;
        continue;
      }
      // If no matching close, fall through
    }

    if (text.substring(i, i + delimLen) === delimiter) {
      // For single-char delimiters, ensure this isn't part of a double
      if (delimLen === 1 && text[i + 1] === delimChar) {
        // This is the start of a ** or __, skip it
        i += 2;
        continue;
      }

      // Content must not end with whitespace
      if (text[i - 1] === " ") {
        i++;
        continue;
      }

      const innerText = text.substring(afterOpen, i);
      if (innerText.length === 0) {
        i++;
        continue;
      }

      const children = parseInline(innerText);

      return {
        segment: { type, children } as
          | BoldSegment
          | ItalicSegment
          | StrikethroughSegment,
        end: i + delimLen,
      };
    }

    i++;
  }

  return null;
}

/**
 * Find matching closing delimiter for a double-char delimiter sequence.
 * Returns the index of the first char of the closing delimiter, or -1.
 */
function findMatchingClose(
  text: string,
  start: number,
  delimiter: string,
): number {
  const delimLen = delimiter.length;
  let i = start;
  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length) {
      i += 2;
      continue;
    }
    if (text.substring(i, i + delimLen) === delimiter) {
      return i;
    }
    i++;
  }
  return -1;
}

function findClosingBracket(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "\\" && i + 1 < text.length) {
      i++;
      continue;
    }
    if (text[i] === "[") depth++;
    if (text[i] === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findClosingParen(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "\\" && i + 1 < text.length) {
      i++;
      continue;
    }
    if (text[i] === "(") depth++;
    if (text[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Get the plain text content from inline segments (strips formatting).
 */
export function inlineToPlainText(segments: InlineSegment[]): string {
  return segments
    .map((seg) => {
      switch (seg.type) {
        case "text":
          return seg.content;
        case "code":
          return seg.content;
        case "bold":
        case "italic":
        case "strikethrough":
          return inlineToPlainText(seg.children);
        case "link":
          return inlineToPlainText(seg.children);
        case "image":
          return seg.alt;
      }
    })
    .join("");
}

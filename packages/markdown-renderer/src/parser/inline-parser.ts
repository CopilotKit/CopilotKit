import { assignCitationNumber } from "./citations";
import {
  findClosing,
  isEmail,
  isEscapable,
  isUrl,
  parseLinkDestination,
  trimAutolinkTrailingPunctuation,
} from "./helpers";
import type { DraftNode, ParseContext, ParseResult } from "./internal";
import { createSegments } from "./segments";
import type {
  CitationState,
  StreamingMarkdownWarning,
  TextSegment,
} from "./types";

/**
 * Parses inline markdown content into inline draft nodes.
 *
 * @param text - Inline source text.
 * @param absoluteStart - Absolute source offset for the first character in `text`.
 * @param path - Stable path prefix for emitted nodes.
 * @param context - Immutable parse context shared across block/inline parsing.
 * @returns Inline draft nodes and updated immutable parser context.
 */
export function parseInline(
  text: string,
  absoluteStart: number,
  path: string,
  context: ParseContext,
): ParseResult<DraftNode[]> {
  const nodes: DraftNode[] = [];
  let i = 0;
  let textBuffer = "";
  let textBufferStart = -1;
  let citations = context.citations;
  let warnings = context.warnings;
  let hasWarnedSegmenterUnavailable = context.hasWarnedSegmenterUnavailable;

  const flushTextBuffer = () => {
    if (textBuffer.length === 0 || textBufferStart < 0) {
      return;
    }

    const appendResult = appendText(
      nodes,
      textBuffer,
      textBufferStart,
      path,
      context.options.segmenter,
      hasWarnedSegmenterUnavailable,
    );
    warnings =
      appendResult.warnings.length > 0
        ? [...warnings, ...appendResult.warnings]
        : warnings;
    hasWarnedSegmenterUnavailable = appendResult.hasWarnedSegmenterUnavailable;
    textBuffer = "";
    textBufferStart = -1;
  };

  const appendBufferedText = (value: string, start: number) => {
    if (value.length === 0) {
      return;
    }

    if (textBuffer.length === 0) {
      textBufferStart = start;
    }

    textBuffer += value;
  };

  while (i < text.length) {
    const current = text[i];

    if (current === "\n") {
      const trailingBackslashes = countTrailing(text, i - 1, "\\");
      const hardByBackslash = trailingBackslashes % 2 === 1;
      const hardBySpaces = i > 1 && text.slice(i - 2, i) === "  ";
      const hard = hardByBackslash || hardBySpaces;

      if (hardByBackslash && textBuffer.endsWith("\\")) {
        textBuffer = textBuffer.slice(0, -1);
      }

      flushTextBuffer();

      nodes.push({
        path: `${path}.${nodes.length}`,
        type: hard ? "hard-break" : "soft-break",
        range: { start: absoluteStart + i, end: absoluteStart + i + 1 },
        closed: true,
        props: {},
        children: [],
      });
      i += 1;
      continue;
    }

    if (current === "\\" && i + 1 < text.length && isEscapable(text[i + 1])) {
      appendBufferedText(text[i + 1], absoluteStart + i);
      i += 2;
      continue;
    }

    const citation = parseCitationInline(
      text,
      i,
      absoluteStart,
      path,
      citations,
      nodes.length,
      context.isComplete,
    );
    if (citation) {
      flushTextBuffer();
      nodes.push(citation.node);
      i = citation.next;
      citations = citation.citations;
      continue;
    }

    const image = parseImageInline(text, i, absoluteStart, path, nodes.length);
    if (image) {
      flushTextBuffer();
      nodes.push(image.node);
      i = image.next;
      continue;
    }

    const link = parseLinkInline(
      text,
      i,
      absoluteStart,
      path,
      nodes.length,
      context,
      citations,
      warnings,
      hasWarnedSegmenterUnavailable,
    );
    if (link) {
      flushTextBuffer();
      nodes.push(link.node);
      i = link.next;
      citations = link.citations;
      warnings = link.warnings;
      hasWarnedSegmenterUnavailable = link.hasWarnedSegmenterUnavailable;
      continue;
    }

    const auto = parseAutolinkInline(
      text,
      i,
      absoluteStart,
      path,
      context.options.enableAutolinks,
      nodes.length,
    );
    if (auto) {
      flushTextBuffer();
      nodes.push(auto.node);
      i = auto.next;
      continue;
    }

    const code = parseInlineCode(text, i, absoluteStart, path, nodes.length);
    if (code) {
      flushTextBuffer();
      nodes.push(code.node);
      i = code.next;
      continue;
    }

    const strong =
      parseDelimitedInline(
        text,
        i,
        "**",
        "strong",
        absoluteStart,
        path,
        nodes.length,
        context,
        citations,
        warnings,
        hasWarnedSegmenterUnavailable,
      ) ??
      parseDelimitedInline(
        text,
        i,
        "__",
        "strong",
        absoluteStart,
        path,
        nodes.length,
        context,
        citations,
        warnings,
        hasWarnedSegmenterUnavailable,
      );
    if (strong) {
      flushTextBuffer();
      nodes.push(strong.node);
      i = strong.next;
      citations = strong.citations;
      warnings = strong.warnings;
      hasWarnedSegmenterUnavailable = strong.hasWarnedSegmenterUnavailable;
      continue;
    }

    const strike = parseDelimitedInline(
      text,
      i,
      "~~",
      "strikethrough",
      absoluteStart,
      path,
      nodes.length,
      context,
      citations,
      warnings,
      hasWarnedSegmenterUnavailable,
    );
    if (strike) {
      flushTextBuffer();
      nodes.push(strike.node);
      i = strike.next;
      citations = strike.citations;
      warnings = strike.warnings;
      hasWarnedSegmenterUnavailable = strike.hasWarnedSegmenterUnavailable;
      continue;
    }

    const em =
      parseDelimitedInline(
        text,
        i,
        "*",
        "em",
        absoluteStart,
        path,
        nodes.length,
        context,
        citations,
        warnings,
        hasWarnedSegmenterUnavailable,
      ) ??
      parseDelimitedInline(
        text,
        i,
        "_",
        "em",
        absoluteStart,
        path,
        nodes.length,
        context,
        citations,
        warnings,
        hasWarnedSegmenterUnavailable,
      );
    if (em) {
      flushTextBuffer();
      nodes.push(em.node);
      i = em.next;
      citations = em.citations;
      warnings = em.warnings;
      hasWarnedSegmenterUnavailable = em.hasWarnedSegmenterUnavailable;
      continue;
    }

    appendBufferedText(text[i], absoluteStart + i);
    i += 1;
  }

  flushTextBuffer();
  const inlineNodes = annotateNoBreakBeforeSegments(nodes);

  return {
    value: inlineNodes,
    citations,
    warnings,
    hasWarnedSegmenterUnavailable,
  };
}

function countTrailing(text: string, index: number, value: string): number {
  let run = 0;
  let i = index;

  while (i >= 0 && text[i] === value) {
    run += 1;
    i -= 1;
  }

  return run;
}

function annotateNoBreakBeforeSegments(nodes: DraftNode[]): DraftNode[] {
  let changed = false;

  const next = nodes.map((node, index) => {
    if (node.type !== "text") {
      return node;
    }

    const segments = node.props["segments"];
    if (!Array.isArray(segments) || segments.length === 0) {
      return node;
    }

    const typedSegments = segments as TextSegment[];
    const firstSegment = typedSegments[0];
    if (!firstSegment) {
      return node;
    }

    const previous = index > 0 ? nodes[index - 1] : null;
    const shouldMark =
      startsWithClosingPunctuation(firstSegment.text) &&
      shouldPreventBreakBeforeNode(previous);
    const alreadyMarked = firstSegment.noBreakBefore === true;

    if (shouldMark === alreadyMarked) {
      return node;
    }

    const nextFirst: TextSegment = shouldMark
      ? { ...firstSegment, noBreakBefore: true }
      : { ...firstSegment, noBreakBefore: undefined };
    const nextSegments = [nextFirst, ...typedSegments.slice(1)];

    changed = true;
    return {
      ...node,
      props: {
        ...node.props,
        segments: nextSegments,
      },
    };
  });

  return changed ? next : nodes;
}

function shouldPreventBreakBeforeNode(node: DraftNode | null): boolean {
  if (!node) {
    return false;
  }

  if (node.type === "soft-break" || node.type === "hard-break") {
    return false;
  }

  if (node.type === "text") {
    const text = String(node.props["text"] ?? "");
    if (!text || /\s$/u.test(text)) {
      return false;
    }
  }

  return true;
}

function startsWithClosingPunctuation(value: string): boolean {
  if (!value) {
    return false;
  }

  const [first] = [...value];
  return first != null && CLOSING_PUNCTUATION.has(first);
}

const CLOSING_PUNCTUATION = new Set([
  "]",
  ",",
  ".",
  "!",
  "?",
  ";",
  ":",
  "%",
  ")",
  "}",
  ">",
  '"',
  "'",
  "、",
  "。",
  "，",
  "．",
  "！",
  "？",
  "：",
  "；",
  "％",
  "）",
  "］",
  "｝",
  "〉",
  "》",
  "」",
  "』",
  "】",
  "〕",
  "〗",
]);

function appendText(
  nodes: DraftNode[],
  text: string,
  start: number,
  path: string,
  segmenter: ParseContext["options"]["segmenter"],
  hasWarnedSegmenterUnavailable: boolean,
): {
  warnings: StreamingMarkdownWarning[];
  hasWarnedSegmenterUnavailable: boolean;
} {
  if (!text) {
    return { warnings: [], hasWarnedSegmenterUnavailable };
  }

  const segmentation = createSegments(text, start, {
    segmenter,
    hasWarnedSegmenterUnavailable,
  });

  nodes.push({
    path: `${path}.${nodes.length}`,
    type: "text",
    range: { start, end: start + text.length },
    closed: true,
    props: {
      text,
      segments: segmentation.segments,
    },
    children: [],
  });

  return {
    warnings: segmentation.warning ? [segmentation.warning] : [],
    hasWarnedSegmenterUnavailable: segmentation.hasWarnedSegmenterUnavailable,
  };
}

function parseCitationInline(
  text: string,
  at: number,
  start: number,
  path: string,
  citations: CitationState,
  index: number,
  isComplete: boolean,
): { node: DraftNode; next: number; citations: CitationState } | null {
  if (!text.startsWith("[^", at)) {
    return null;
  }

  const close = text.indexOf("]", at + 2);
  if (close >= 0) {
    const idRef = text.slice(at + 2, close).trim();
    if (!idRef) {
      return null;
    }

    const numbered = assignCitationNumber(citations, idRef);

    return {
      node: {
        path: `${path}.${index}`,
        type: "citation",
        range: { start: start + at, end: start + close + 1 },
        closed: true,
        props: { idRef, number: numbered.number },
        children: [],
      },
      next: close + 1,
      citations: numbered.citations,
    };
  }

  if (isComplete) {
    return null;
  }

  const partial = text.slice(at);
  if (!/^\[\^[^\]\s]+$/u.test(partial)) {
    return null;
  }

  const partialIdRef = partial.slice(2);

  return {
    node: {
      path: `${path}.${index}`,
      type: "citation",
      range: { start: start + at, end: start + text.length },
      closed: false,
      props: { idRef: partialIdRef },
      children: [],
    },
    next: text.length,
    citations,
  };
}

function parseImageInline(
  text: string,
  at: number,
  start: number,
  path: string,
  index: number,
): { node: DraftNode; next: number } | null {
  if (!text.startsWith("![", at)) {
    return null;
  }

  const labelEnd = findClosing(text, at + 1, "[", "]");
  if (labelEnd < 0 || text[labelEnd + 1] !== "(") {
    return null;
  }

  const destEnd = findClosing(text, labelEnd + 1, "(", ")");
  if (destEnd < 0) {
    return null;
  }

  const alt = text.slice(at + 2, labelEnd);
  const parsed = parseLinkDestination(text.slice(labelEnd + 2, destEnd));

  return {
    node: {
      path: `${path}.${index}`,
      type: "image",
      range: { start: start + at, end: start + destEnd + 1 },
      closed: true,
      props: {
        url: parsed.url,
        alt,
        ...(parsed.title ? { title: parsed.title } : {}),
      },
      children: [],
    },
    next: destEnd + 1,
  };
}

function parseLinkInline(
  text: string,
  at: number,
  start: number,
  path: string,
  index: number,
  context: ParseContext,
  citations: CitationState,
  warnings: StreamingMarkdownWarning[],
  hasWarnedSegmenterUnavailable: boolean,
): {
  node: DraftNode;
  next: number;
  citations: CitationState;
  warnings: StreamingMarkdownWarning[];
  hasWarnedSegmenterUnavailable: boolean;
} | null {
  if (text[at] !== "[" || text.startsWith("[^", at)) {
    return null;
  }

  const labelEnd = findClosing(text, at, "[", "]");
  if (labelEnd < 0 || text[labelEnd + 1] !== "(") {
    return null;
  }

  const destEnd = findClosing(text, labelEnd + 1, "(", ")");
  if (destEnd < 0) {
    return null;
  }

  const label = text.slice(at + 1, labelEnd);
  const parsed = parseLinkDestination(text.slice(labelEnd + 2, destEnd));
  const childResult = parseInline(label, start + at + 1, `${path}.${index}`, {
    ...context,
    citations,
    warnings,
    hasWarnedSegmenterUnavailable,
  });

  return {
    node: {
      path: `${path}.${index}`,
      type: "link",
      range: { start: start + at, end: start + destEnd + 1 },
      closed: true,
      props: {
        url: parsed.url,
        ...(parsed.title ? { title: parsed.title } : {}),
      },
      children: childResult.value,
    },
    next: destEnd + 1,
    citations: childResult.citations,
    warnings: childResult.warnings,
    hasWarnedSegmenterUnavailable: childResult.hasWarnedSegmenterUnavailable,
  };
}

function parseAutolinkInline(
  text: string,
  at: number,
  start: number,
  path: string,
  enabled: boolean,
  index: number,
): { node: DraftNode; next: number } | null {
  if (!enabled) {
    return null;
  }

  if (text[at] === "<") {
    const close = text.indexOf(">", at + 1);
    if (close > at + 1) {
      const value = text.slice(at + 1, close).trim();
      if (isUrl(value) || isEmail(value)) {
        const url = isEmail(value) ? `mailto:${value}` : value;
        return {
          node: {
            path: `${path}.${index}`,
            type: "autolink",
            range: { start: start + at, end: start + close + 1 },
            closed: true,
            props: { url, text: value },
            children: [],
          },
          next: close + 1,
        };
      }
    }
  }

  const boundaryOk = at === 0 || /\s|[([{"'`]/.test(text[at - 1]);
  if (!boundaryOk) {
    return null;
  }

  const match =
    /^(https?:\/\/\S+|www\.\S+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/.exec(
      text.slice(at),
    );
  if (!match) {
    return null;
  }

  const raw = trimAutolinkTrailingPunctuation(match[1]);
  if (!raw) {
    return null;
  }

  const url = isEmail(raw)
    ? `mailto:${raw}`
    : raw.startsWith("www.")
      ? `https://${raw}`
      : raw;

  return {
    node: {
      path: `${path}.${index}`,
      type: "autolink",
      range: { start: start + at, end: start + at + raw.length },
      closed: true,
      props: {
        url,
        text: raw,
      },
      children: [],
    },
    next: at + raw.length,
  };
}

function parseInlineCode(
  text: string,
  at: number,
  start: number,
  path: string,
  index: number,
): { node: DraftNode; next: number } | null {
  if (text[at] !== "`") {
    return null;
  }

  let len = 1;
  while (text[at + len] === "`") {
    len += 1;
  }

  const delimiter = "`".repeat(len);
  const close = text.indexOf(delimiter, at + len);
  if (close < 0) {
    return {
      node: {
        path: `${path}.${index}`,
        type: "inline-code",
        range: { start: start + at, end: start + text.length },
        closed: false,
        props: {
          text: text.slice(at + len),
        },
        children: [],
      },
      next: text.length,
    };
  }

  return {
    node: {
      path: `${path}.${index}`,
      type: "inline-code",
      range: { start: start + at, end: start + close + len },
      closed: true,
      props: {
        text: text.slice(at + len, close),
      },
      children: [],
    },
    next: close + len,
  };
}

function parseDelimitedInline(
  text: string,
  at: number,
  delimiter: string,
  type: "em" | "strong" | "strikethrough",
  start: number,
  path: string,
  index: number,
  context: ParseContext,
  citations: CitationState,
  warnings: StreamingMarkdownWarning[],
  hasWarnedSegmenterUnavailable: boolean,
): {
  node: DraftNode;
  next: number;
  citations: CitationState;
  warnings: StreamingMarkdownWarning[];
  hasWarnedSegmenterUnavailable: boolean;
} | null {
  if (!text.startsWith(delimiter, at)) {
    return null;
  }

  const close = text.indexOf(delimiter, at + delimiter.length);
  if (close < 0) {
    const content = text.slice(at + delimiter.length);
    const children = parseInline(
      content,
      start + at + delimiter.length,
      `${path}.${index}`,
      {
        ...context,
        citations,
        warnings,
        hasWarnedSegmenterUnavailable,
      },
    );

    return {
      node: {
        path: `${path}.${index}`,
        type,
        range: { start: start + at, end: start + text.length },
        closed: false,
        props: {},
        children: children.value,
      },
      next: text.length,
      citations: children.citations,
      warnings: children.warnings,
      hasWarnedSegmenterUnavailable: children.hasWarnedSegmenterUnavailable,
    };
  }

  const content = text.slice(at + delimiter.length, close);
  const children = parseInline(
    content,
    start + at + delimiter.length,
    `${path}.${index}`,
    {
      ...context,
      citations,
      warnings,
      hasWarnedSegmenterUnavailable,
    },
  );

  return {
    node: {
      path: `${path}.${index}`,
      type,
      range: { start: start + at, end: start + close + delimiter.length },
      closed: true,
      props: {},
      children: children.value,
    },
    next: close + delimiter.length,
    citations: children.citations,
    warnings: children.warnings,
    hasWarnedSegmenterUnavailable: children.hasWarnedSegmenterUnavailable,
  };
}

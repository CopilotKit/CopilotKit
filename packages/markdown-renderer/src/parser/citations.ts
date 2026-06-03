import type { CitationState, StreamingMarkdownWarning } from './types';

/**
 * Extracts citation definitions from source text.
 *
 * @param source - Full normalized markdown source.
 * @param warnings - Mutable warning collection for parse diagnostics.
 * @returns Citation state with collected definitions and empty reference order.
 */
export function parseCitationDefinitions(source: string): {
  citations: CitationState;
  warnings: StreamingMarkdownWarning[];
} {
  const definitions: CitationState['definitions'] = {};
  const warnings: StreamingMarkdownWarning[] = [];
  const lines = source.split('\n');
  let offset = 0;

  for (const line of lines) {
    const match = /^\s{0,3}\[\^([^\]\s]+)\]:\s*(.*)$/.exec(line);

    if (!match) {
      offset += line.length + 1;
      continue;
    }

    const id = match[1];

    if (definitions[id]) {
      warnings.push({ code: 'invalid_citation_definition', at: offset });
      offset += line.length + 1;
      continue;
    }

    const extracted = extractTrailingUrl(match[2].trim());
    definitions[id] = {
      id,
      text: extracted.text,
      ...(extracted.url ? { url: extracted.url } : {}),
    };

    offset += line.length + 1;
  }

  return {
    citations: {
      order: [],
      numbers: {},
      definitions,
    },
    warnings,
  };
}

/**
 * Assigns or returns a stable citation number by first-seen inline reference order.
 *
 * @param citations - Citation state that tracks numbering.
 * @param idRef - Citation identifier (without `[^` and `]` markers).
 * @returns Stable numeric citation number.
 */
export function assignCitationNumber(
  citations: CitationState,
  idRef: string,
): { citations: CitationState; number: number } {
  const existing = citations.numbers[idRef];
  if (typeof existing === 'number') {
    return { citations, number: existing };
  }

  const next = citations.order.length + 1;
  return {
    citations: {
      ...citations,
      order: [...citations.order, idRef],
      numbers: { ...citations.numbers, [idRef]: next },
    },
    number: next,
  };
}

function extractTrailingUrl(input: string): { text: string; url?: string } {
  if (!input) {
    return { text: '' };
  }

  const match = /(?:\s|^)(https?:\/\/\S+|www\.\S+)$/.exec(input);

  if (!match) {
    return { text: input };
  }

  return {
    text: input.slice(0, match.index).trimEnd(),
    url: match[1],
  };
}

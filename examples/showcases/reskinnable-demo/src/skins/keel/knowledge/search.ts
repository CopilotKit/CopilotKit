/**
 * Deterministic lexical retrieval over the Keel corpus (spec §5.2).
 * SERVER-SAFE and PURE: no React, no network, no randomness, no clock. The same
 * query must return byte-identical citations on every call — the demo and
 * search.test.ts both depend on it.
 */
import type { Citation, KnowledgeSpace } from "./types";
import { KEEL_CORPUS } from "./corpus";

/** Words that carry no retrieval signal and are dropped before scoring. */
const STOPWORDS = new Set<string>([
  "a", "an", "the", "and", "or", "but", "of", "to", "for", "in", "on", "at",
  "by", "is", "are", "was", "were", "be", "been", "being", "do", "does", "did",
  "we", "i", "you", "our", "my", "your", "us", "it", "its", "this", "that",
  "these", "those", "with", "from", "as", "s", "t", "can", "could", "should",
  "would", "will", "what", "whats", "which", "who", "how", "when", "where",
  "why", "please", "me", "about", "into", "over", "need", "needs", "give",
  "gives", "giving", "get", "got", "any", "all",
]);

/**
 * Domain synonym map (spec §5.2 minimum set, plus a few natural extras). Keys
 * may be single tokens (matched against query tokens) or phrases (matched
 * against the normalized query string). Expansions are tokenized before use.
 */
const SYNONYMS: Record<string, string[]> = {
  contractor: ["workforce member", "vendor"],
  "patient records": ["phi", "protected health information"],
  "patient data": ["phi", "protected health information"],
  doctor: ["practitioner"],
  physician: ["practitioner"],
  onboard: ["credentialing", "clearance"],
  incident: ["adverse event", "breach"],
  vendor: ["third party", "business associate"],
  breach: ["privacy incident"],
};

/** Weights: a term hit in the heading, document title, and section body. */
const HEADING_WEIGHT = 3;
const TITLE_WEIGHT = 2;
const BODY_WEIGHT = 1;

/** Minimum score a section must reach to be returned — filters coincidental noise. */
const MIN_SCORE = 2;

const DEFAULT_LIMIT = 4;
const SNIPPET_LENGTH = 200;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Query tokens after stopword removal and synonym expansion (order-independent set). */
function expandQuery(query: string): string[] {
  const normalized = query.toLowerCase();
  const terms = new Set(tokenize(query).filter((t) => !STOPWORDS.has(t)));

  for (const [key, expansions] of Object.entries(SYNONYMS)) {
    const keyTokens = tokenize(key);
    const matched =
      keyTokens.length === 1 ? terms.has(key) : normalized.includes(key);
    if (!matched) continue;
    for (const expansion of expansions) {
      for (const token of tokenize(expansion)) terms.add(token);
    }
  }

  return [...terms].filter((t) => !STOPWORDS.has(t));
}

/** ~200 chars of body, centred on the earliest matched term (spec §5.2). */
function makeSnippet(body: string, terms: string[]): string {
  if (body.length <= SNIPPET_LENGTH) return body;

  const lower = body.toLowerCase();
  let bestIdx = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) bestIdx = idx;
  }

  if (bestIdx === -1) {
    return body.slice(0, SNIPPET_LENGTH).trimEnd() + "…";
  }

  const half = Math.floor(SNIPPET_LENGTH / 2);
  let end = Math.min(body.length, Math.max(bestIdx - half, 0) + SNIPPET_LENGTH);
  const start = Math.max(0, end - SNIPPET_LENGTH);
  end = Math.min(body.length, start + SNIPPET_LENGTH);

  let snippet = body.slice(start, end).trim();
  if (start > 0) snippet = "…" + snippet;
  if (end < body.length) snippet = snippet + "…";
  return snippet;
}

interface ScoredHit {
  citation: Citation;
  score: number;
  ref: string;
  sectionId: string;
}

/**
 * Search the corpus for a query. Lowercase-tokenizes, drops stopwords, expands
 * through the synonym map, scores every section (heading 3 / title 2 / body 1),
 * keeps those above MIN_SCORE, and returns the top `limit` (default 4) as
 * Citations. Ordering is score desc, then document `ref` asc, then sectionId asc
 * — a fully-determined total order.
 */
export function searchCorpus(
  query: string,
  opts?: { space?: KnowledgeSpace; limit?: number },
): Citation[] {
  const terms = expandQuery(query);
  if (terms.length === 0) return [];

  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const hits: ScoredHit[] = [];

  for (const doc of KEEL_CORPUS) {
    if (opts?.space && doc.space !== opts.space) continue;
    const titleTokens = new Set(tokenize(doc.title));

    for (const section of doc.sections) {
      const headingTokens = new Set(tokenize(section.heading));
      const bodyTokens = new Set(tokenize(section.body));

      let score = 0;
      for (const term of terms) {
        if (headingTokens.has(term)) score += HEADING_WEIGHT;
        if (titleTokens.has(term)) score += TITLE_WEIGHT;
        if (bodyTokens.has(term)) score += BODY_WEIGHT;
      }
      if (score < MIN_SCORE) continue;

      hits.push({
        score,
        ref: doc.ref,
        sectionId: section.id,
        citation: {
          docId: doc.id,
          ref: doc.ref,
          sectionId: section.id,
          heading: section.heading,
          snippet: makeSnippet(section.body, terms),
        },
      });
    }
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      a.ref.localeCompare(b.ref) ||
      a.sectionId.localeCompare(b.sectionId),
  );

  return hits.slice(0, limit).map((h) => h.citation);
}

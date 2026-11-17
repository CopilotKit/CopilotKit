import type { SortedResult } from "fumadocs-core/search";

// Orders search results by page. Orama scores each heading and paragraph on
// its own (BM25), so a short paragraph that happens to repeat a word beats the
// page whose title is that word, and a common word in a query ("in", "the")
// counts as much as the word the reader meant. This keeps Orama's matches and
// re-ranks the pages they belong to: a page whose title, URL, or headings
// carry every word of the query first, the reader's paragraph matches after.

/** Words that say nothing about which page a reader wants. */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "my",
  "of",
  "on",
  "or",
  "the",
  "to",
  "use",
  "using",
  "what",
  "when",
  "where",
  "which",
  "with",
  "why",
  "you",
  "your",
]);

/** A string's words, lowercased, with `camelCase` and `kebab-case` split. */
function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** The words of a query that pick a page: its stop words dropped, unless that's all it has. */
export function queryTerms(query: string): string[] {
  const all = [...new Set(words(query))];
  const meaningful = all.filter((w) => !STOP_WORDS.has(w));
  return meaningful.length ? meaningful : all;
}

/** How many of `terms` the text has, as a share (0 to 1). A term matches a word it starts. */
function coverage(terms: string[], text: string): number {
  if (!terms.length) return 0;
  const have = words(text);
  // The whole query as one word, too: "useAgent" matches `useAgent`.
  const joined = have.join("");
  let found = 0;
  for (const term of terms) {
    if (have.some((w) => w.startsWith(term)) || joined.includes(term)) found++;
  }
  return found / terms.length;
}

interface PageGroup {
  page: SortedResult;
  hits: SortedResult[];
  /** Where Orama ranked the page, for ties. */
  order: number;
}

/** Fumadocs' result list as pages, each followed by its heading and text hits. */
function groups(results: SortedResult[]): PageGroup[] {
  const out: PageGroup[] = [];
  for (const result of results) {
    if (result.type === "page") {
      out.push({ page: result, hits: [], order: out.length });
    } else {
      out.at(-1)?.hits.push(result);
    }
  }
  return out;
}

const text = (result: SortedResult) =>
  typeof result.content === "string" ? result.content : "";

/**
 * A page's score for the query. The weights: the title carries the most,
 * then the URL (which names the framework or frontend, `/mastra/...`), the
 * breadcrumbs, the headings, and last the body text.
 */
function score(group: PageGroup, terms: string[], query: string): number {
  const title = text(group.page);
  const url = group.page.url.split("#")[0];
  const crumbs = (group.page.breadcrumbs ?? []).join(" ");
  let total = 0;

  const inTitle = coverage(terms, title);
  total += inTitle * 10;
  if (inTitle === 1) total += 6;
  if (words(title).join(" ") === words(query).join(" ")) total += 8;

  const inUrl = coverage(terms, url);
  total += inUrl * 6;
  total += coverage(terms, crumbs) * 3;

  const headings = group.hits.filter((h) => h.type === "heading");
  const best = (hits: SortedResult[]) =>
    hits.reduce((max, h) => Math.max(max, coverage(terms, text(h))), 0);
  total += best(headings) * 4;
  total += best(group.hits.filter((h) => h.type === "text")) * 2;
  // More matching sections is a small signal that the page is about it.
  total += Math.min(group.hits.length, 8) * 0.15;

  // The legacy v1 reference repeats v2's names; the current API comes first.
  if (url.startsWith("/reference/v1/")) total -= 4;
  return total;
}

/**
 * Fumadocs' results re-ranked by page (see the module comment), each page's
 * hits that carry the most query words first, cut to `limit` entries.
 */
export function rankResults(
  results: SortedResult[],
  query: string,
  limit = 60,
): SortedResult[] {
  const terms = queryTerms(query);
  if (!terms.length) return results.slice(0, limit);
  const ranked = groups(results)
    .map((group) => ({ group, score: score(group, terms, query) }))
    .sort((a, b) => b.score - a.score || a.group.order - b.group.order);

  const out: SortedResult[] = [];
  for (const { group } of ranked) {
    if (out.length >= limit) break;
    out.push(group.page);
    const hits = [...group.hits].sort(
      (a, b) => coverage(terms, text(b)) - coverage(terms, text(a)),
    );
    for (const hit of hits) {
      if (out.length >= limit) break;
      out.push(hit);
    }
  }
  return out;
}

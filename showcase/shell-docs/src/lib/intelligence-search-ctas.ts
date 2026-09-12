// Curated Intelligence recommendations for the docs search modal.
//
// A reader who types "threads" or "self-hosting" into docs search is
// asking a question CopilotKit Intelligence answers directly, but the
// organic result list can only rank pages by title — it has no way to
// say "here is the guide that actually addresses this". This module is
// that editorial layer: a small keyword-to-recommendation table plus a
// matcher, kept deliberately free of React, network calls and side
// effects so it can be read, reviewed and tested as plain data.
//
// Rules the data must keep (all enforced by
// lib/__tests__/intelligence-search-ctas.test.ts):
//
//  - Every destination is an INTERNAL docs route. Never an absolute URL:
//    the modal navigates through next/router and an external href would
//    both break client-side routing and drop the reader out of the docs.
//  - Specificity is DECLARED, never inferred from keyword counts or
//    string lengths, so "intelligence threads" resolving to the threads
//    entry is a fact you can read off the table.
//  - Exactly one entry ever renders.

import type { DocsCtaAttribution } from "@/lib/docs-cta-href";
import { buildTrackedDocsHref } from "@/lib/docs-cta-href";

export interface IntelligenceSearchCtaLink {
  label: string;
  /** Internal docs route, e.g. "/intelligence/quickstart". */
  href: string;
}

export interface IntelligenceSearchCta {
  /** Stable identifier — flows into the PostHog event and the utm_content. */
  id: string;
  /**
   * Words that trigger this entry. Matched as whole typed words, or as a
   * typed prefix of at least four characters.
   */
  keywords: readonly string[];
  /**
   * Higher wins when several entries match. Declared, not inferred: the
   * catch-all "intelligence" entry must never beat a topic entry.
   */
  specificity: number;
  title: string;
  body: string;
  primary: IntelligenceSearchCtaLink;
  secondary: readonly IntelligenceSearchCtaLink[];
}

/**
 * Shortest typed prefix that may fire an entry. "intell" should find the
 * Intelligence block; "in" should not turn every search into an advert.
 */
const MIN_PREFIX_LENGTH = 4;

export const INTELLIGENCE_SEARCH_CTAS: readonly IntelligenceSearchCta[] = [
  {
    id: "threads",
    keywords: ["threads", "thread", "persistence", "persistent"],
    specificity: 30,
    title: "Threads that survive a reload",
    // Deliberate wording: CopilotKit's own threads are open source and
    // free. What Intelligence adds is the durable, resumable storage
    // behind them, so this must not read as "threads are a paid feature".
    body: "Threads are built into CopilotKit. Intelligence stores them for you, so conversations resume across reloads, sessions and devices without you running a database.",
    primary: { label: "Read the Threads guide", href: "/threads" },
    secondary: [
      {
        label: "How thread persistence works",
        href: "/intelligence/threads-explained",
      },
      { label: "Connect Intelligence", href: "/intelligence/quickstart" },
      { label: "What Intelligence adds", href: "/intelligence/overview" },
    ],
  },
  {
    id: "self-hosting",
    keywords: ["self-hosting", "self-host", "selfhosted", "self-hosted"],
    specificity: 20,
    title: "Run Intelligence on your own infrastructure",
    body: "Intelligence self-hosts on your own cloud, in your own network, with your data staying inside your perimeter.",
    primary: {
      label: "Read the self-hosting guide",
      href: "/intelligence/self-hosting",
    },
    secondary: [
      { label: "What Intelligence adds", href: "/intelligence/overview" },
      {
        label: "Platform architecture",
        href: "/intelligence/intelligence-platform",
      },
    ],
  },
  {
    // No docs page describes learning on its own yet — it is a capability
    // row on the Intelligence overview, which links out to the detail.
    // The overview is also the right landing for a reader already running
    // Intelligence, for whom a connect-in-five-minutes quickstart would
    // be useless. Retargeting when a dedicated page ships is a one-line
    // edit here.
    id: "learning",
    keywords: ["learning"],
    specificity: 10,
    title: "Agents that learn from real conversations",
    body: "Intelligence turns the conversations your agent already has into evaluations and improvements, instead of leaving that signal on the floor.",
    primary: {
      label: "See what Intelligence adds",
      href: "/intelligence/overview",
    },
    secondary: [
      { label: "Connect Intelligence", href: "/intelligence/quickstart" },
      { label: "Threads guide", href: "/threads" },
    ],
  },
  {
    // Same reasoning as "learning" above: analytics has no dedicated
    // docs page yet.
    id: "analytics",
    keywords: ["analytics"],
    specificity: 10,
    title: "See what your agent actually does",
    body: "Intelligence reports on the runs, tool calls and conversations behind your agent, so you can tell what is working in production.",
    primary: {
      label: "See what Intelligence adds",
      href: "/intelligence/overview",
    },
    secondary: [
      { label: "Connect Intelligence", href: "/intelligence/quickstart" },
      { label: "Threads guide", href: "/threads" },
    ],
  },
  {
    id: "intelligence",
    keywords: ["intelligence"],
    // Lowest: the catch-all. Any topic entry above outranks it, which is
    // why "intelligence threads" resolves to the threads entry.
    specificity: 1,
    title: "CopilotKit Intelligence",
    body: "Persistent threads, analytics, automatic learning and production operations on top of the runtime you already run.",
    primary: {
      label: "See what Intelligence adds",
      href: "/intelligence/overview",
    },
    secondary: [
      { label: "Connect in 5 minutes", href: "/intelligence/quickstart" },
      { label: "Threads guide", href: "/threads" },
      { label: "Self-hosting", href: "/intelligence/self-hosting" },
    ],
  },
];

/** Splits a query into the words a reader actually typed. */
function typedWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(Boolean);
}

/**
 * A typed word triggers a keyword when it IS that keyword, or when it is
 * a long-enough prefix of it.
 *
 * Never a plain substring test in either direction: substring matching
 * makes "spreadsheets" fire the threads block, which is how a curated
 * recommendation turns into noise.
 */
function wordTriggersKeyword(word: string, keyword: string): boolean {
  if (word === keyword) return true;
  return word.length >= MIN_PREFIX_LENGTH && keyword.startsWith(word);
}

/**
 * The single recommendation to show for `query`, or null when the query
 * is about something else. When several entries match, the highest
 * declared specificity wins.
 */
export function matchIntelligenceSearchCta(
  query: string,
): IntelligenceSearchCta | null {
  const words = typedWords(query);
  if (words.length === 0) return null;

  let best: IntelligenceSearchCta | null = null;
  for (const cta of INTELLIGENCE_SEARCH_CTAS) {
    const matches = cta.keywords.some((keyword) =>
      words.some((word) => wordTriggersKeyword(word, keyword)),
    );
    if (!matches) continue;
    if (!best || cta.specificity > best.specificity) best = cta;
  }

  return best;
}

/**
 * Placeholder origin used only to run an internal path through the
 * shared attribution helper. `buildTrackedDocsHref` takes an absolute
 * URL (it is built for outbound CTAs), so a relative docs route has to
 * be resolved against SOME origin before it can carry query params, and
 * stripped back afterwards. The origin never reaches the returned href,
 * and `.invalid` is reserved by RFC 2606 so it cannot resolve if it
 * somehow leaked.
 */
const INTERNAL_HREF_BASE = "https://internal.invalid";

/**
 * Attribution-tagged version of an internal docs route.
 *
 * Returns a root-relative href so the modal can hand it straight to
 * next/router: client-side routing and the modal's close behaviour stay
 * exactly as they are for organic results, while the destination page
 * still sees the same utm_* attribution every other docs CTA sends.
 */
export function buildTrackedInternalDocsHref(
  destination: string,
  attribution: DocsCtaAttribution,
): string {
  const absolute = new URL(destination, INTERNAL_HREF_BASE).toString();
  const tracked = new URL(buildTrackedDocsHref(absolute, attribution));
  return `${tracked.pathname}${tracked.search}${tracked.hash}`;
}

/** PostHog `location` / `utm_content` value for one search recommendation. */
export function intelligenceSearchCtaSurface(
  ctaId: string,
  matchedKeyword: string,
): string {
  return `docs-search:${ctaId}:${matchedKeyword}`;
}

/**
 * The keyword that actually fired the entry — reported alongside the
 * click so the funnel can tell "threads" traffic from "persistence"
 * traffic. Falls back to the entry's first keyword, which cannot happen
 * for an entry that matched but keeps the return type honest.
 */
export function matchedKeywordFor(
  cta: IntelligenceSearchCta,
  query: string,
): string {
  const words = typedWords(query);
  for (const keyword of cta.keywords) {
    if (words.some((word) => wordTriggersKeyword(word, keyword))) {
      return keyword;
    }
  }
  return cta.keywords[0];
}

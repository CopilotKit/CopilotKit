"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronDown, Search, X } from "lucide-react";
import searchIndex from "@/data/search-index.json";
import { DEFAULT_FRAMEWORK, useFramework } from "./framework-provider";
import { frontendFromPathname, isFrontendId } from "@/lib/frontend-options";
import type { FrontendId } from "@/lib/frontend-options";
import { FrameworkLogo } from "./icons/framework-icons";
import { compareByDisplayOrder } from "@/lib/framework-order";
import type { Registry } from "@/lib/registry";
import { getRuntimeConfig } from "@/lib/runtime-config.client";
import {
  buildFrameworkSearchOptions,
  frameworkDocsHref,
  isChannelDocsHref,
  normalizeHref,
  parseChannelDocsHref,
  parseDocsHref,
  parseIntegrationDocsHref,
  reconcileFrameworkSearchSelection,
  resolveChannelSearchResults,
} from "@/lib/search-hrefs";
import type { FrameworkSearchOption } from "@/lib/search-hrefs";
import { matchIntelligenceSearchCta } from "@/lib/intelligence-search-ctas";
import {
  activateIntelligenceSearchCta,
  IntelligenceSearchCtaBlock,
} from "./intelligence-search-cta";

// This modal searches DOCS ONLY. The integrations explorer and the
// feature matrix live on the shell host (showcase.copilotkit.ai) and are
// deliberately not searchable from here: readers asking a docs question
// were getting showcase destinations mixed into their results, and the
// feature rows had no docs page to point at at all.
//
// The registry is still loaded, for two reasons that have nothing to do
// with producing results: the framework scope picker is built from it,
// and the integration-docs branch below needs its docs-folder map.
//
// `/integrations` and `/matrix` can still reach the result list from a
// stale cached search index, so normalizeHref() keeps rewriting those two
// onto the shell host rather than letting them 404 here. The host is read
// at runtime from window.__SHOWCASE_CONFIG__ (set by the root layout) so a
// single built artifact serves staging and prod — see
// lib/runtime-config.client.

type SearchResultType = "page" | "reference" | "ag-ui" | "docs";

interface SearchIndexEntry {
  type: "page" | "reference" | "ag-ui";
  title: string;
  subtitle: string;
  section?: string;
  href: string;
}

interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string;
  section?: string;
  href: string;
  frameworkName?: string;
  frameworkCount?: number;
}

// Ties the search input to the result list for assistive technology:
// the input is the combobox, the list is its popup, and the selected row
// is announced through aria-activedescendant as arrow keys move.
const RESULTS_LISTBOX_ID = "docs-search-results";
const CTA_GROUP_ID = "docs-search-recommendation";
const CTA_OPTION_ID = `${CTA_GROUP_ID}-primary`;

function isExternalHref(href: string): boolean {
  // Protocol-relative or http(s) URLs, plus non-navigable schemes that
  // next/router can't handle (mailto/tel/ftp[s]) — all must leave the SPA
  // via window.location rather than router.push.
  return /^(https?:)?\/\//i.test(href) || /^(mailto|tel|ftp|ftps):/i.test(href);
}

function dedupeResults(items: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const item of items) {
    const key = `${item.type}::${item.href}::${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

const DOCS_FOLDER_OVERRIDES: Record<string, string> = {
  "langgraph-python": "langgraph",
  "langgraph-typescript": "langgraph",
  "langgraph-fastapi": "langgraph",
  "google-adk": "adk",
  "crewai-crews": "crewai-flows",
  strands: "aws-strands",
  "strands-typescript": "aws-strands",
  "ms-agent-dotnet": "microsoft-agent-framework",
  "ms-agent-python": "microsoft-agent-framework",
};

function getDocsFolderForSlug(slug: string): string {
  return DOCS_FOLDER_OVERRIDES[slug] ?? slug;
}

function buildDocsFolderMap(
  registryData: Registry | null,
): Map<string, FrameworkSearchOption[]> {
  const map = new Map<string, FrameworkSearchOption[]>();
  for (const integration of registryData?.integrations ?? []) {
    if (integration.docs_mode === "hidden") continue;
    const folder = getDocsFolderForSlug(integration.slug);
    const next = map.get(folder) ?? [];
    next.push({
      slug: integration.slug,
      name: integration.name,
      logo: integration.logo ?? null,
    });
    map.set(folder, next);
  }

  for (const options of map.values()) {
    options.sort((a, b) => compareByDisplayOrder(a.slug, b.slug));
  }

  return map;
}

// Punctuation a reader routinely leaves out when typing a title they half
// remember: apostrophes (straight and curly), hyphens, dots and slashes.
// It is DELETED rather than turned into a space, and on both sides, so
// "whats new" reaches "What's New" and "self hosting" reaches
// "Self-hosting" — replacing with a space would leave "what s new", which
// the query "whats" still could not find.
const IGNORED_PUNCTUATION = /['’./-]+/g;

// The boundary inside a camelCase or PascalCase identifier: a lower-case
// letter or digit immediately followed by a capital. Split on the HAYSTACK
// side only — the reader types words, the docs are full of identifiers —
// so "use Copilot kit" reaches `useCopilotKit` and "copilot chat" reaches
// `CopilotChat`.
const CAMEL_CASE_BOUNDARY = /([a-z0-9])([A-Z])/g;

/**
 * The searchable form of an entry's text: the plain form AND, when the text
 * holds an identifier, the camel-split form appended after it.
 *
 * Both are needed. Splitting alone would break the reader who types the
 * identifier as one word — `useCopilotKit` split to "use copilot kit" no
 * longer contains "usecopilotkit" — and not splitting is what made
 * "use Copilot kit" miss in the first place.
 *
 * This runs over every entry on every keystroke, so it stays two regex
 * passes over one already-joined string rather than a tokenizer, and skips
 * the concatenation entirely for text with no identifier in it.
 */
function normalizeHaystack(text: string): string {
  const plain = text.replace(IGNORED_PUNCTUATION, "").toLowerCase();
  const split = text
    .replace(CAMEL_CASE_BOUNDARY, "$1 $2")
    .replace(IGNORED_PUNCTUATION, "")
    .toLowerCase();
  return split === plain ? plain : `${plain} ${split}`;
}

/** The query with the same punctuation removed, still split into words. */
function normalizeQuery(query: string): string {
  return query.replace(IGNORED_PUNCTUATION, "").toLowerCase();
}

/**
 * Punctuation, camelCase boundaries and spacing all removed. Used only to
 * recognise a title the reader spelled out in words — "ag ui" for "AG-UI",
 * "whats new" for "What's New", "use Copilot kit" for `useCopilotKit`.
 */
function condense(text: string): string {
  return text
    .replace(IGNORED_PUNCTUATION, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function matchesQuery(
  fields: Array<string | undefined>,
  query: string,
): boolean {
  const terms = normalizeQuery(query).split(/\s+/).filter(Boolean);
  const haystack = normalizeHaystack(fields.filter(Boolean).join(" "));
  return terms.every((term) => haystack.includes(term));
}

function formatType(type: SearchResultType): string {
  if (type === "ag-ui") return "AG-UI";
  if (type === "docs") return "Docs";
  return type;
}

const WORD_CHARACTER = /[a-z0-9]/;

/**
 * True when `needle` appears in `haystack` standing on its own rather than
 * buried inside a longer word. Both arguments must already be lowercased.
 *
 * Used instead of a `\b` regex so the query needs no escaping and so a
 * query with leading or trailing punctuation still behaves sensibly.
 */
function matchesWholeWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  for (let from = 0; ; from += 1) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : haystack[at - 1];
    const after = haystack[at + needle.length] ?? "";
    if (!WORD_CHARACTER.test(before) && !WORD_CHARACTER.test(after)) {
      return true;
    }
    from = at;
  }
}

// ---------------------------------------------------------------------
// Frontend affinity
//
// The index is one flat list across every frontend, so a React reader
// searching "chat" got a screen of Angular: of 78 matches, roughly 38
// belonged to a frontend they are not using. Those rows are DEMOTED,
// never filtered — a React reader who wants the Angular page must still
// find it by typing "angular chat", and because both words then match,
// those rows climb back to the top on their own merits.
// ---------------------------------------------------------------------

/**
 * The frontend a destination belongs to, or null when it is
 * frontend-agnostic. Agnostic destinations are never penalized.
 *
 * Two shapes name a frontend: a leading `/vue/…`, `/angular/…`,
 * `/react-native/…`, `/slack/…`, `/teams/…` segment, and the same names
 * one segment into the API reference (`/reference/angular/…`). Reference
 * sub-trees that are not frontends — `/reference/hooks`, `/reference/core`,
 * `/reference/channels`, `/reference/v1` — fall through to null.
 */
function frontendFromHref(href: string): FrontendId | null {
  const segments = href.split(/[?#]/)[0].split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const candidate = segments[0] === "reference" ? segments[1] : segments[0];
  return isFrontendId(candidate) ? candidate : null;
}

/** Words that count as the reader naming a frontend in their query. */
const FRONTEND_QUERY_PHRASES: Record<FrontendId, readonly string[]> = {
  react: ["react"],
  "react-spa": ["react spa"],
  vue: ["vue"],
  "react-native": ["react native"],
  angular: ["angular"],
  slack: ["slack"],
  teams: ["teams"],
};

/**
 * Frontends the query names outright. Their pages keep their natural rank,
 * so "angular chat" puts Angular back on top from any surface.
 */
function frontendsNamedInQuery(query: string): Set<FrontendId> {
  // Padded with spaces and matched as whole phrases so "react" does not
  // count as naming React Native, and so a typed "react-native" — where
  // the hyphen is a word separator, not noise — still counts.
  const padded = ` ${query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
  const named = new Set<FrontendId>();
  for (const [frontend, phrases] of Object.entries(FRONTEND_QUERY_PHRASES)) {
    if (phrases.some((phrase) => padded.includes(` ${phrase} `))) {
      named.add(frontend as FrontendId);
    }
  }
  return named;
}

interface RankingContext {
  /**
   * The frontend the reader is on. `frontendFromPathname` returns null both
   * on the root surface and under `/react/…`, and React is the effective
   * default there — so a React reader sees agnostic and React pages ahead
   * of Angular and Vue rather than the other way round.
   */
  readerFrontend: FrontendId;
  namedFrontends: ReadonlySet<FrontendId>;
}

/**
 * Added to the score of a row belonging to a frontend the reader is not
 * using and did not ask for.
 *
 * 40 is the smallest round number that makes the demotion reliable. The
 * widest swing the title bonuses can produce inside one result type is 36
 * — an exact title match (-30) on a framework-scoped docs row (-6) — so
 * anything above that guarantees a foreign-frontend row sits below every
 * same-type row that is agnostic or matches the reader. It is deliberately
 * not larger: the whole type ladder spans 0 to 40, so a demoted row falls
 * by about one ladder height and may mix with the next type down, but the
 * types keep their relative order among demoted rows and nothing is
 * dropped from the list.
 */
const FOREIGN_FRONTEND_PENALTY = 40;

/**
 * The V1 reference is deprecated and answers with an API that no longer
 * exists. Its 35-odd entries sort below everything else — handled as its
 * own comparator tier rather than a score, because "always last" is a
 * rule, not a weighting that another bonus could out-argue.
 */
function isDeprecatedV1Href(href: string): boolean {
  return href === "/reference/v1" || href.startsWith("/reference/v1/");
}

function scoreResult(
  result: SearchResult,
  query: string,
  context: RankingContext,
): number {
  // The title tiers below compare the same normalized forms the filter
  // uses. Without that, a query the filter now accepts could still score
  // zero against the very page it was typed for: "ag ui" matched "AG-UI"
  // but was ranked as if it had matched nothing, and so never surfaced.
  const q = normalizeQuery(query);
  const title = normalizeHaystack(result.title);
  const typePriority: Record<SearchResultType, number> = {
    docs: 0,
    page: 1,
    reference: 3,
    "ag-ui": 4,
  };

  let score = typePriority[result.type] * 10;

  const frontend = frontendFromHref(result.href);
  if (
    frontend !== null &&
    frontend !== context.readerFrontend &&
    !context.namedFrontends.has(frontend)
  ) {
    score += FOREIGN_FRONTEND_PENALTY;
  }

  if (result.frameworkName) score -= 6;
  // Spelling the title out in words is still naming it exactly: "ag ui"
  // for "AG-UI", "use Copilot kit" for `useCopilotKit`.
  if (condense(result.title) === condense(query)) score -= 30;
  // A whole-word hit anywhere in the title beats one buried inside a
  // longer word. This slot used to be `title.startsWith(q)`, which was a
  // crude stand-in for the same idea: it rewarded the query only when it
  // was the FIRST word, so searching "threads" put "Threads Drawer" above
  // the canonical "Rich Threads" guide, and left "useThreads" — where
  // "threads" is not a word at all — tied with it.
  else if (matchesWholeWord(title, q)) score -= 18;
  else if (title.includes(q)) score -= 8;

  return score;
}

/**
 * Total order over results for one query. Everything the score leaves tied
 * is settled here, so the result order can never fall back on the order the
 * search index happened to be generated in.
 */
function compareResults(
  a: SearchResult,
  b: SearchResult,
  query: string,
  context: RankingContext,
): number {
  // Deprecated V1 reference pages sink below every other result, whatever
  // their frontend and however well their title matches.
  const byDeprecation =
    Number(isDeprecatedV1Href(a.href)) - Number(isDeprecatedV1Href(b.href));
  if (byDeprecation !== 0) return byDeprecation;

  const byScore =
    scoreResult(a, query, context) - scoreResult(b, query, context);
  if (byScore !== 0) return byScore;

  // A shorter title is nearly always the more general, canonical page for
  // a topic: "Rich Threads" is the Threads guide, "Threads Drawer" is one
  // component within it.
  if (a.title.length !== b.title.length) {
    return a.title.length - b.title.length;
  }

  const byTitle = a.title.localeCompare(b.title);
  if (byTitle !== 0) return byTitle;

  // Two rows can share a title — the same reference symbol documented for
  // several frontends, say. Destination is the last discriminator and makes
  // the order total, so it never falls through to the order the index
  // happened to be generated in.
  return a.href.localeCompare(b.href);
}

export function SearchModal({ onClose }: { onClose: () => void }) {
  const { effectiveFramework, knownFrameworks, setStoredFramework } =
    useFramework();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedFramework, setSelectedFramework] = useState(
    effectiveFramework || DEFAULT_FRAMEWORK,
  );
  const [frameworkPickerOpen, setFrameworkPickerOpen] = useState(false);
  const [registryData, setRegistryData] = useState<Registry | null>(null);
  const [registryError, setRegistryError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedIndexRef = useRef(0);
  // What moved the selection last. The result list scrolls to follow the
  // selection only for "keyboard": hover moves the selection too, and
  // scrolling on hover would slide the list out from under the pointer.
  const selectionSourceRef = useRef<"keyboard" | "pointer">("pointer");
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const activeFrontend = frontendFromPathname(pathname);

  // Keep a ref in sync with selectedIndex so the Enter handler never reads
  // a stale closure value (reset-on-input + key-handler race).
  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  useEffect(() => {
    const focusInput = () => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    };
    const frameId = window.requestAnimationFrame(focusInput);
    const focusId = window.setTimeout(focusInput, 80);
    let cancelled = false;
    import("@/data/registry.json")
      .then((mod) => {
        if (!cancelled) setRegistryData(mod.default as Registry);
      })
      .catch((err) => {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.error("[search-modal] failed to load registry", err);
          setRegistryError(true);
        }
      });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(focusId);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [onClose]);

  const frameworkOptions = useMemo(() => {
    if (!registryData) return [];
    return buildFrameworkSearchOptions(
      registryData.integrations,
      knownFrameworks,
    );
  }, [registryData, knownFrameworks]);

  const selectedFrameworkOption = useMemo(
    () =>
      frameworkOptions.find((option) => option.slug === selectedFramework) ??
      null,
    [frameworkOptions, selectedFramework],
  );

  useEffect(() => {
    const reconciledFramework = reconcileFrameworkSearchSelection(
      selectedFramework,
      frameworkOptions,
    );
    if (reconciledFramework !== selectedFramework) {
      setSelectedFramework(reconciledFramework);
    }
  }, [frameworkOptions, selectedFramework]);

  const chooseFramework = useCallback(
    (slug: string) => {
      setSelectedFramework(slug);
      setStoredFramework(slug);
      setSelectedIndex(0);
      setFrameworkPickerOpen(false);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true });
        inputRef.current?.select();
      });
    },
    [setStoredFramework],
  );

  // Read the shell host once per render from the runtime config injected
  // into window by the root layout. Pulled inside the component (not at
  // module top) because the value only exists after hydration and the
  // client reader throws on the server. Threaded into normalizeHref()
  // and the integration href below so neither one re-reads window.
  const shellHost = getRuntimeConfig().shellUrl;

  const results = useMemo(() => {
    if (!query.trim()) return [];

    const q = query.trim();
    const items: SearchResult[] = [];
    const docsFolderMap = buildDocsFolderMap(registryData);
    const selectedFrameworkName =
      frameworkOptions.find((option) => option.slug === selectedFramework)
        ?.name ?? selectedFramework;
    const docsGroups = new Map<
      string,
      {
        topic: string;
        entry: SearchIndexEntry;
        href: string;
        id?: string;
        title?: string;
        frameworkCount?: number;
      }
    >();

    // Static search index is available immediately — search it even before
    // the dynamic registry.json has resolved.
    // Auto-generated by: npx tsx showcase/scripts/generate-search-index.ts
    const pages = searchIndex as SearchIndexEntry[];

    for (const p of pages) {
      const channelDoc = parseChannelDocsHref(p.href);
      if (channelDoc) {
        const channelResults = resolveChannelSearchResults({
          topic: channelDoc.topic,
          title: p.title,
          selectedFramework,
          activeFrontend,
        });
        for (const channelResult of channelResults) {
          if (
            !matchesQuery(
              [channelResult.title, p.subtitle, p.section, channelDoc.topic],
              q,
            )
          ) {
            continue;
          }
          docsGroups.set(channelResult.groupKey, {
            topic: channelDoc.topic,
            entry: p,
            href: channelResult.href,
            id: channelResult.id,
            title: channelResult.title,
          });
        }
        continue;
      }
      // A stale or malformed index must not route an unknown Channels source
      // through the generic framework-docs path.
      if (isChannelDocsHref(p.href)) continue;

      const integrationDoc = parseIntegrationDocsHref(p.href);
      if (integrationDoc) {
        const options = docsFolderMap.get(integrationDoc.folder) ?? [];
        const selectedOption = options.find(
          (option) => option.slug === selectedFramework,
        );
        if (!selectedOption) continue;
        if (
          !matchesQuery(
            [
              p.title,
              p.subtitle,
              p.section,
              selectedOption.name,
              selectedOption.slug,
              integrationDoc.topic,
            ],
            q,
          )
        ) {
          continue;
        }
        docsGroups.set(integrationDoc.topic || "overview", {
          topic: integrationDoc.topic,
          entry: p,
          href: frameworkDocsHref(
            selectedOption.slug,
            integrationDoc.topic,
            activeFrontend,
          ),
          frameworkCount: options.length,
        });
        continue;
      }

      const docsTopic = parseDocsHref(p.href);
      if (docsTopic !== null) {
        if (!matchesQuery([p.title, p.subtitle, p.section, docsTopic], q)) {
          continue;
        }
        if (!docsGroups.has(docsTopic)) {
          docsGroups.set(docsTopic, {
            topic: docsTopic,
            entry: p,
            href: frameworkDocsHref(
              selectedFramework,
              docsTopic,
              activeFrontend,
            ),
          });
        }
        continue;
      }

      if (matchesQuery([p.title, p.subtitle, p.section], q)) {
        items.push({
          id: p.href,
          type: p.type,
          title: p.title,
          subtitle: p.subtitle,
          section: p.section,
          href: normalizeHref(p.href, shellHost),
        });
      }
    }

    for (const group of docsGroups.values()) {
      items.push({
        id: group.id ?? `docs:${group.topic}`,
        type: "docs",
        title: group.title ?? group.entry.title,
        subtitle: group.entry.subtitle,
        section: group.entry.section || "Framework docs",
        href: group.href,
        frameworkName: group.frameworkCount ? selectedFrameworkName : undefined,
        frameworkCount: group.frameworkCount,
      });
    }

    const ranking: RankingContext = {
      readerFrontend: activeFrontend ?? "react",
      namedFrontends: frontendsNamedInQuery(q),
    };

    return dedupeResults(items)
      .sort((a, b) => compareResults(a, b, q, ranking))
      .slice(0, 12);
  }, [
    query,
    registryData,
    selectedFramework,
    frameworkOptions,
    shellHost,
    activeFrontend,
  ]);

  // The curated Intelligence recommendation, when the query asks for a
  // topic Intelligence answers directly. It is an ADDITION above the
  // result list, never a replacement: it takes no result slot and the
  // twelve organic results below it are untouched.
  const intelligenceCta = useMemo(
    () => matchIntelligenceSearchCta(query),
    [query],
  );

  // One selection model for the whole modal. When the recommendation is
  // showing it occupies index 0 and results shift down by one, so
  // arrow-down out of the block lands on the first result and Enter
  // activates whatever is selected.
  const ctaOffset = intelligenceCta ? 1 : 0;
  const selectableCount = ctaOffset + results.length;

  useEffect(() => {
    setSelectedIndex((idx) =>
      selectableCount === 0 ? 0 : Math.min(idx, selectableCount - 1),
    );
  }, [selectableCount]);

  // The result list is a fixed-height scroller, so arrowing past the fifth
  // or sixth row used to move the selection out of sight. Rows carry a
  // stable DOM id, so the selected one is found by id rather than through
  // a ref array. `block: "nearest"` is the minimal scroll: the list moves
  // only when the row would otherwise be off-screen, instead of recentring
  // on every keystroke. The recommendation block sits outside the scroller
  // and stays visible, so there is nothing to scroll to while the
  // selection is on it.
  useEffect(() => {
    if (selectionSourceRef.current !== "keyboard") return;
    const rowIndex = selectedIndex - ctaOffset;
    if (rowIndex < 0) return;
    const row = document.getElementById(
      `${RESULTS_LISTBOX_ID}-option-${rowIndex}`,
    );
    // Optional call: jsdom and older engines do not implement it, and a
    // missing scroll must never break navigation.
    row?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex, ctaOffset]);

  const navigateTo = useCallback(
    (href: string) => {
      setFrameworkPickerOpen(false);
      if (isExternalHref(href)) {
        window.location.assign(href);
      } else {
        router.push(href);
      }
      onClose();
    },
    [router, onClose],
  );

  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Don't hijack keys while an IME composition is active — Asian-language
      // users press Enter to commit a candidate and must not trigger navigation.
      if (e.nativeEvent.isComposing) return;

      if (e.key === "ArrowDown") {
        if (selectableCount === 0) return;
        e.preventDefault();
        selectionSourceRef.current = "keyboard";
        // Clamped, never wrapped: at the end of the list the selection
        // stays on the last row rather than jumping back to the top.
        setSelectedIndex((i) => Math.min(i + 1, selectableCount - 1));
      } else if (e.key === "ArrowUp") {
        if (selectableCount === 0) return;
        e.preventDefault();
        selectionSourceRef.current = "keyboard";
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const idx = selectedIndexRef.current;
        if (intelligenceCta && idx === 0) {
          e.preventDefault();
          activateIntelligenceSearchCta({
            cta: intelligenceCta,
            query,
            destination: intelligenceCta.primary.href,
            attribution: {
              frontend: activeFrontend ?? undefined,
              backend: selectedFramework,
            },
            navigate: navigateTo,
          });
          return;
        }
        const chosen = results[idx - ctaOffset];
        if (chosen) {
          e.preventDefault();
          navigateTo(chosen.href);
        }
      }
    },
    [
      activeFrontend,
      ctaOffset,
      intelligenceCta,
      navigateTo,
      query,
      results,
      selectableCount,
      selectedFramework,
    ],
  );

  const registryLoading = !registryData && !registryError;
  const hasFrameworkPicker = frameworkOptions.length > 0;
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const hasContentBelowScope =
    registryError ||
    (hasQuery && registryLoading) ||
    intelligenceCta !== null ||
    results.length > 0 ||
    (hasQuery && results.length === 0 && !registryLoading);

  // Announces the current selection to assistive technology whether it
  // sits on the recommendation or on a result row.
  const activeDescendantId =
    selectableCount === 0
      ? undefined
      : intelligenceCta && selectedIndex === 0
        ? CTA_OPTION_ID
        : `${RESULTS_LISTBOX_ID}-option-${selectedIndex - ctaOffset}`;

  return (
    <>
      <div
        className="fixed inset-0 z-[200] bg-[var(--overlay-backdrop)] backdrop-blur-sm"
        onMouseDown={onClose}
      />
      <div
        className="fixed top-[12%] left-1/2 z-[201] w-full max-w-2xl -translate-x-1/2 px-4"
        role="dialog"
        aria-modal="true"
        aria-label="Search documentation"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDownCapture={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="shell-docs-radius-surface overflow-visible border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-modal)]">
          <div
            aria-hidden="true"
            className="h-px bg-gradient-to-r from-transparent via-[var(--accent)]/70 to-transparent"
          />
          <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
            <Search className="h-4 w-4 text-[var(--text-muted)]" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                selectionSourceRef.current = "keyboard";
                setSelectedIndex(0);
              }}
              onKeyDown={onInputKeyDown}
              role="combobox"
              aria-expanded={selectableCount > 0}
              aria-controls={
                intelligenceCta
                  ? `${CTA_GROUP_ID} ${RESULTS_LISTBOX_ID}`
                  : RESULTS_LISTBOX_ID
              }
              aria-activedescendant={activeDescendantId}
              aria-autocomplete="list"
              placeholder="Search docs, guides, API reference..."
              className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
            />
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }}
              className="shell-docs-radius-control inline-flex h-7 w-7 cursor-pointer items-center justify-center text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
              aria-label="Close search"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div
            className={`relative flex items-center gap-2 bg-[var(--bg-elevated)]/45 px-5 py-2.5 text-[12px] text-[var(--text-muted)] ${
              hasContentBelowScope
                ? "border-b border-[var(--border)]"
                : "rounded-b-xl"
            }`}
          >
            <span className="shrink-0">Searching docs for</span>
            <div className="relative min-w-0">
              <button
                type="button"
                disabled={!hasFrameworkPicker}
                onClick={() => setFrameworkPickerOpen((open) => !open)}
                className="shell-docs-radius-control inline-flex h-8 max-w-[min(56vw,220px)] cursor-pointer items-center justify-between gap-2 border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 text-left text-xs font-semibold text-[var(--text)] outline-none transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-hover)] focus-visible:border-[var(--accent)] disabled:cursor-default disabled:opacity-60"
                aria-haspopup="listbox"
                aria-expanded={frameworkPickerOpen}
                aria-label={`Choose docs framework. Currently ${
                  selectedFrameworkOption?.name ?? "loading frameworks"
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {selectedFrameworkOption && (
                    <FrameworkLogo
                      slug={selectedFrameworkOption.slug}
                      fallbackSrc={selectedFrameworkOption.logo}
                      className="shrink-0 text-[var(--accent)]"
                      size={14}
                    />
                  )}
                  <span className="truncate">
                    {selectedFrameworkOption?.name ?? "Loading frameworks"}
                  </span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
              </button>

              {frameworkPickerOpen && hasFrameworkPicker && (
                <div
                  role="listbox"
                  className="shell-docs-radius-surface absolute left-0 top-full z-10 mt-2 max-h-[280px] w-[min(360px,calc(100vw-3rem))] overflow-y-auto border border-[var(--border)] bg-[var(--bg-surface)] p-1.5 shadow-[var(--shadow-panel)]"
                >
                  {frameworkOptions.map((option) => {
                    const selected = option.slug === selectedFramework;
                    return (
                      <button
                        key={option.slug}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => chooseFramework(option.slug)}
                        className={`shell-docs-radius-control flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                          selected
                            ? "bg-[var(--accent)]/10 text-[var(--text)]"
                            : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                        }`}
                      >
                        <span
                          className={`shell-docs-radius-icon inline-flex h-7 w-7 shrink-0 items-center justify-center border ${
                            selected
                              ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
                              : "border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)]"
                          }`}
                        >
                          <FrameworkLogo
                            slug={option.slug}
                            fallbackSrc={option.logo}
                            size={16}
                          />
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {option.name}
                        </span>
                        {selected && (
                          <Check className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {registryError && (
            <div className="px-5 py-2.5 text-[12px] text-[var(--text-muted)] border-b border-[var(--border)] bg-[var(--bg-elevated)]">
              Search index failed to load. Try refresh.
            </div>
          )}

          {hasQuery && registryLoading && (
            <div className="px-5 py-2 text-[11px] text-[var(--text-faint)] border-b border-[var(--border)]">
              Loading integrations and framework docs...
            </div>
          )}

          {intelligenceCta && (
            <IntelligenceSearchCtaBlock
              cta={intelligenceCta}
              query={query}
              groupId={CTA_GROUP_ID}
              optionId={CTA_OPTION_ID}
              selected={selectedIndex === 0}
              onHover={() => {
                selectionSourceRef.current = "pointer";
                setSelectedIndex(0);
              }}
              onNavigate={navigateTo}
              attribution={{
                frontend: activeFrontend ?? undefined,
                backend: selectedFramework,
              }}
            />
          )}

          {results.length > 0 && (
            <div
              id={RESULTS_LISTBOX_ID}
              role="listbox"
              aria-label="Search results"
              className="max-h-[390px] overflow-y-auto p-2"
            >
              {results.map((r, idx) => (
                <button
                  key={r.id}
                  id={`${RESULTS_LISTBOX_ID}-option-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={idx + ctaOffset === selectedIndex}
                  className={`shell-docs-radius-control flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left transition-colors ${
                    idx + ctaOffset === selectedIndex
                      ? "bg-[var(--bg-elevated)]"
                      : "hover:bg-[var(--bg-hover)]"
                  }`}
                  onClick={() => navigateTo(r.href)}
                  onMouseEnter={() => {
                    selectionSourceRef.current = "pointer";
                    setSelectedIndex(idx + ctaOffset);
                  }}
                >
                  <span className="text-[10px] font-mono text-[var(--text-faint)] uppercase w-16 shrink-0">
                    {formatType(r.type)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        data-search-result-title
                        className="truncate text-[13px] font-semibold text-[var(--text)]"
                      >
                        {r.title}
                      </span>
                      {r.section && (
                        <span className="hidden shrink-0 text-[11px] font-normal text-[var(--text-faint)] sm:inline">
                          {r.section}
                        </span>
                      )}
                      {isDeprecatedV1Href(r.href) && (
                        <span
                          data-search-result-deprecated
                          className="shell-docs-radius-icon shrink-0 border border-[var(--border)] px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-[var(--text-faint)]"
                        >
                          Deprecated
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate">
                      {r.subtitle}
                    </div>
                    {r.frameworkName && (
                      <div className="mt-1 text-[10px] font-medium text-[var(--accent)]">
                        {r.frameworkName}
                        {r.frameworkCount && r.frameworkCount > 1
                          ? ` selected from ${r.frameworkCount} backends`
                          : " selected"}
                      </div>
                    )}
                  </div>
                  <ArrowRight
                    // Must use the same offset selection test as the row's
                    // own background and aria-selected: comparing the bare
                    // `idx` lit the arrow one row BELOW the selected one
                    // whenever the recommendation block took index 0.
                    className={`h-4 w-4 shrink-0 transition-colors ${
                      idx + ctaOffset === selectedIndex
                        ? "text-[var(--accent)]"
                        : "text-[var(--text-faint)]"
                    }`}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          )}

          {hasQuery && results.length === 0 && !registryLoading && (
            <div className="px-5 py-8 text-center text-[13px] text-[var(--text-muted)]">
              No results for &ldquo;{query}&rdquo;
            </div>
          )}
        </div>
      </div>
    </>
  );
}

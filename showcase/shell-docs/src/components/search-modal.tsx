"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronDown, Search, X } from "lucide-react";
import searchIndex from "@/data/search-index.json";
import { DEFAULT_FRAMEWORK, useFramework } from "./framework-provider";
import { frontendFromPathname } from "@/lib/frontend-options";
import { FrameworkLogo } from "./icons/framework-icons";
import { compareByDisplayOrder } from "@/lib/framework-order";
import type { Registry } from "@/lib/registry";
import { getRuntimeConfig } from "@/lib/runtime-config.client";
import {
  frameworkDocsHref,
  normalizeHref,
  parseDocsHref,
  parseIntegrationDocsHref,
} from "@/lib/search-hrefs";

// Integrations explorer + per-integration demo pages live on the shell
// host (showcase.copilotkit.ai), not on shell-docs. Search results that
// surface an integration or one of its demos route there directly. The
// shell host is now read at runtime from window.__SHOWCASE_CONFIG__
// (set by the root layout) so a single built artifact can serve
// staging vs prod without rebuilding — see lib/runtime-config.client.

type SearchResultType =
  | "integration"
  | "feature"
  | "page"
  | "reference"
  | "ag-ui"
  | "docs";

interface SearchIndexEntry {
  type: "page" | "reference" | "ag-ui";
  title: string;
  subtitle: string;
  section?: string;
  href: string;
}

interface FrameworkOption {
  slug: string;
  name: string;
  logo?: string | null;
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
): Map<string, FrameworkOption[]> {
  const map = new Map<string, FrameworkOption[]>();
  for (const integration of registryData?.integrations ?? []) {
    if (integration.docs_mode === "hidden") continue;
    const folder = getDocsFolderForSlug(integration.slug);
    const next = map.get(folder) ?? [];
    next.push({
      slug: integration.slug,
      name: integration.name,
      logo: integration.logo,
    });
    map.set(folder, next);
  }

  for (const options of map.values()) {
    options.sort((a, b) => compareByDisplayOrder(a.slug, b.slug));
  }

  return map;
}

function matchesQuery(
  fields: Array<string | undefined>,
  query: string,
): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = fields.filter(Boolean).join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function scoreResult(result: SearchResult, query: string): number {
  const q = query.toLowerCase();
  const title = result.title.toLowerCase();
  const typePriority: Record<SearchResultType, number> = {
    docs: 0,
    page: 1,
    integration: 2,
    reference: 3,
    "ag-ui": 4,
    feature: 6,
  };

  let score = typePriority[result.type] * 10;
  if (result.frameworkName) score -= 6;
  if (title === q) score -= 30;
  else if (title.startsWith(q)) score -= 18;
  else if (title.includes(q)) score -= 8;

  return score;
}

function scrubMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[\s>*-]+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatFrameworkScope(result: SearchResult): string | null {
  if (!result.frameworkName) return null;
  if (result.frameworkCount && result.frameworkCount > 1) {
    return `${result.frameworkName} · ${result.frameworkCount} backends`;
  }
  return result.frameworkName;
}

export function SearchModal({ onClose }: { onClose: () => void }) {
  const { effectiveFramework, setStoredFramework } = useFramework();
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
    const integrations = registryData?.integrations ?? [];
    return integrations
      .filter((i) => i.docs_mode !== "hidden")
      .map((i) => ({
        slug: i.slug,
        name: i.name,
        logo: i.logo,
      }))
      .sort((a, b) => compareByDisplayOrder(a.slug, b.slug));
  }, [registryData]);

  const selectedFrameworkOption = useMemo(
    () =>
      frameworkOptions.find((option) => option.slug === selectedFramework) ??
      null,
    [frameworkOptions, selectedFramework],
  );

  useEffect(() => {
    if (frameworkOptions.length === 0) return;
    if (frameworkOptions.some((option) => option.slug === selectedFramework)) {
      return;
    }
    const fallback =
      frameworkOptions.find((option) => option.slug === DEFAULT_FRAMEWORK) ??
      frameworkOptions[0];
    setSelectedFramework(fallback.slug);
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
        frameworkCount?: number;
      }
    >();

    // Static search index is available immediately — search it even before
    // the dynamic registry.json has resolved.
    // Auto-generated by: npx tsx showcase/scripts/generate-search-index.ts
    const pages = searchIndex as SearchIndexEntry[];

    for (const p of pages) {
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
        id: `docs:${group.topic}`,
        type: "docs",
        title: group.entry.title,
        subtitle: group.entry.subtitle,
        section: group.entry.section || "Framework docs",
        href: group.href,
        frameworkName: group.frameworkCount ? selectedFrameworkName : undefined,
        frameworkCount: group.frameworkCount,
      });
    }

    if (registryData) {
      for (const i of registryData.integrations || []) {
        if (
          process.env.NODE_ENV !== "production" &&
          (!i.description || i.description.trim() === "")
        ) {
          // eslint-disable-next-line no-console
          console.warn(
            `[search-modal] integration "${i.slug}" has no description — fix upstream in registry`,
          );
        }
        if (matchesQuery([i.name, i.description], q)) {
          items.push({
            id: `integration:${i.slug}`,
            type: "integration",
            title: i.name,
            subtitle: (i.description || "").slice(0, 80),
            href: `${shellHost}/integrations/${i.slug}`,
          });
        }
      }

      for (const f of registryData.feature_registry?.features || []) {
        if (matchesQuery([f.name, f.description], q)) {
          items.push({
            id: `feature:${f.id}`,
            type: "feature",
            title: f.name,
            subtitle: f.description,
            href: "/",
          });
        }
      }
    }

    return dedupeResults(items)
      .sort((a, b) => scoreResult(a, q) - scoreResult(b, q))
      .slice(0, 12);
  }, [
    query,
    registryData,
    selectedFramework,
    frameworkOptions,
    shellHost,
    activeFrontend,
  ]);

  useEffect(() => {
    setSelectedIndex((idx) =>
      results.length === 0 ? 0 : Math.min(idx, results.length - 1),
    );
  }, [results.length]);

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
        if (results.length === 0) return;
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        if (results.length === 0) return;
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const idx = selectedIndexRef.current;
        const chosen = results[idx];
        if (chosen) {
          e.preventDefault();
          navigateTo(chosen.href);
        }
      }
    },
    [results, navigateTo],
  );

  const registryLoading = !registryData && !registryError;
  const hasFrameworkPicker = frameworkOptions.length > 0;
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const hasContentBelowScope =
    registryError ||
    (hasQuery && registryLoading) ||
    results.length > 0 ||
    (hasQuery && results.length === 0 && !registryLoading);

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
        <div className="shell-docs-radius-surface overflow-visible border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-modal)]">
          <div
            aria-hidden="true"
            className="h-px bg-gradient-to-r from-transparent via-[var(--brand-accent)]/70 to-transparent"
          />
          <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
            <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={onInputKeyDown}
              placeholder="Search docs, API reference, integrations..."
              className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
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
              className="shell-docs-radius-control inline-flex h-7 w-7 items-center justify-center text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
              aria-label="Close search"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div
            className={`relative flex items-center gap-2 bg-[var(--secondary)]/45 px-5 py-2.5 text-[12px] text-[var(--muted-foreground)] ${
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
                className="shell-docs-radius-control inline-flex h-8 max-w-[min(56vw,220px)] items-center justify-between gap-2 border border-[var(--border)] bg-[var(--card)] px-2.5 text-left text-xs font-semibold text-[var(--foreground)] outline-none transition-colors hover:border-[var(--brand-accent)] hover:bg-[var(--muted)] focus-visible:border-[var(--brand-accent)] disabled:opacity-60"
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
                      className="shrink-0 text-[var(--brand-accent)]"
                      size={14}
                    />
                  )}
                  <span className="truncate">
                    {selectedFrameworkOption?.name ?? "Loading frameworks"}
                  </span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
              </button>

              {frameworkPickerOpen && hasFrameworkPicker && (
                <div
                  role="listbox"
                  className="shell-docs-radius-surface absolute left-0 top-full z-10 mt-2 max-h-[280px] w-[min(360px,calc(100vw-3rem))] overflow-y-auto border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-[var(--shadow-panel)]"
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
                        className={`shell-docs-radius-control flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                          selected
                            ? "bg-[var(--brand-accent)]/10 text-[var(--foreground)]"
                            : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                        }`}
                      >
                        <span
                          className={`shell-docs-radius-icon inline-flex h-7 w-7 shrink-0 items-center justify-center border ${
                            selected
                              ? "border-[var(--brand-accent)] bg-[var(--accent-dim)] text-[var(--brand-accent)]"
                              : "border-[var(--border)] bg-[var(--secondary)] text-[var(--muted-foreground)]"
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
                          <Check className="h-4 w-4 shrink-0 text-[var(--brand-accent)]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {registryError && (
            <div className="px-5 py-2.5 text-[12px] text-[var(--muted-foreground)] border-b border-[var(--border)] bg-[var(--secondary)]">
              Search index failed to load. Try refresh.
            </div>
          )}

          {hasQuery && registryLoading && (
            <div className="px-5 py-2 text-[11px] text-[var(--muted-foreground)] border-b border-[var(--border)]">
              Loading integrations and framework docs...
            </div>
          )}

          {results.length > 0 && (
            <div className="max-h-[390px] overflow-y-auto p-2">
              {results.map((r, idx) => {
                const subtitle = scrubMarkdown(r.subtitle);
                const frameworkScope = formatFrameworkScope(r);

                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors focus-visible:bg-[var(--secondary)] ${
                      idx === selectedIndex
                        ? "bg-[var(--secondary)]"
                        : "hover:bg-[var(--muted)]"
                    }`}
                    onClick={() => navigateTo(r.href)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-[var(--foreground)]">
                          {r.title}
                        </span>
                        {r.section && (
                          <span className="hidden shrink-0 text-[11px] font-normal text-[var(--muted-foreground)] sm:inline">
                            {r.section}
                          </span>
                        )}
                      </div>
                      {subtitle && (
                        <div className="truncate text-[11px] text-[var(--muted-foreground)]">
                          {subtitle}
                        </div>
                      )}
                      {frameworkScope && (
                        <div className="mt-1 truncate text-[10px] font-normal text-[var(--muted-foreground)]">
                          {frameworkScope}
                        </div>
                      )}
                    </div>
                    <ArrowRight
                      className={`h-4 w-4 shrink-0 transition-colors ${
                        idx === selectedIndex
                          ? "text-[var(--brand-accent)]"
                          : "text-[var(--muted-foreground)]"
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          )}

          {hasQuery && results.length === 0 && !registryLoading && (
            <div className="px-5 py-8 text-center text-[13px] text-[var(--muted-foreground)]">
              No results for &ldquo;{query}&rdquo;
            </div>
          )}
        </div>
      </div>
    </>
  );
}

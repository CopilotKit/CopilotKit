"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronDown, Search, X } from "lucide-react";
import {
  SearchDialog,
  SearchDialogContent,
  SearchDialogOverlay,
} from "fumadocs-ui/components/dialog/search";
import type { SharedProps } from "fumadocs-ui/components/dialog/search";

import searchIndex from "@/data/search-index.json";
import { DEFAULT_FRAMEWORK, useFramework } from "./framework-provider";
import { frontendFromPathname } from "@/lib/frontend-options";
import { FrameworkLogo } from "./icons/framework-icons";
import { compareByDisplayOrder } from "@/lib/framework-order";
import type { Registry } from "@/lib/registry";
import { getRuntimeConfig } from "@/lib/runtime-config.client";
import { navigateToSearchHref } from "@/lib/search-navigation";
import {
  buildQuickSearchResults,
  buildSearchResults,
  groupSearchResults,
} from "@/lib/search-results";
import type {
  SearchIndexEntry,
  SearchResult,
  SearchResultType,
} from "@/lib/search-results";

const SEARCH_PAGES = searchIndex as SearchIndexEntry[];

interface SearchModalProps extends SharedProps {
  loadRegistry?: () => Promise<Registry>;
  restoreFocus?: () => void;
}

function loadSearchRegistry(): Promise<Registry> {
  return import("@/data/registry.json").then(
    (registryModule) => registryModule.default as Registry,
  );
}

function formatType(type: SearchResultType): string {
  if (type === "ag-ui") return "AG-UI";
  if (type === "docs") return "Docs";
  return type;
}

export function SearchModal({
  open,
  onOpenChange,
  loadRegistry = loadSearchRegistry,
  restoreFocus,
}: SearchModalProps) {
  const { effectiveFramework, setStoredFramework } = useFramework();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedFramework, setSelectedFramework] = useState(
    effectiveFramework || DEFAULT_FRAMEWORK,
  );
  const [frameworkPickerOpen, setFrameworkPickerOpen] = useState(false);
  const [frameworkFocusIndex, setFrameworkFocusIndex] = useState(0);
  const [registryData, setRegistryData] = useState<Registry | null>(null);
  const [registryError, setRegistryError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const frameworkTriggerRef = useRef<HTMLButtonElement>(null);
  const frameworkOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const resultOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndexRef = useRef(0);
  const previousSelectedIndexRef = useRef(selectedIndex);
  const previousOpenRef = useRef(open);
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const activeFrontend = frontendFromPathname(pathname);
  const generatedId = useId().replace(/:/g, "");
  const listboxId = `shell-docs-search-results-${generatedId}`;
  const shellHost = getRuntimeConfig().shellUrl;

  useEffect(() => {
    let cancelled = false;
    setRegistryError(false);
    loadRegistry()
      .then((registry) => {
        if (!cancelled) setRegistryData(registry);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("[search-modal] failed to load registry", error);
        setRegistryError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loadRegistry]);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  useEffect(() => {
    const previousSelectedIndex = previousSelectedIndexRef.current;
    previousSelectedIndexRef.current = selectedIndex;
    if (previousSelectedIndex === selectedIndex) return;
    resultOptionRefs.current[selectedIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [selectedIndex]);

  useEffect(() => {
    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = open;

    if (!open) {
      setFrameworkPickerOpen(false);
      return;
    }
    if (!wasOpen) {
      setSelectedFramework(effectiveFramework || DEFAULT_FRAMEWORK);
    }
  }, [effectiveFramework, open]);

  const frameworkOptions = useMemo(() => {
    return (registryData?.integrations ?? [])
      .filter((integration) => integration.docs_mode !== "hidden")
      .map((integration) => ({
        slug: integration.slug,
        name: integration.name,
        logo: integration.logo,
      }))
      .sort((left, right) => compareByDisplayOrder(left.slug, right.slug));
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

  useEffect(() => {
    if (!frameworkPickerOpen) return;
    const focusedOption = frameworkOptionRefs.current[frameworkFocusIndex];
    if (!focusedOption) return;
    focusedOption.focus({ preventScroll: true });
    focusedOption.scrollIntoView({ block: "nearest" });
  }, [frameworkFocusIndex, frameworkPickerOpen]);

  const focusFrameworkOption = useCallback((index: number) => {
    setFrameworkFocusIndex(index);
  }, []);

  const openFrameworkPicker = useCallback(() => {
    if (frameworkOptions.length === 0) return;
    const selectedOptionIndex = frameworkOptions.findIndex(
      (option) => option.slug === selectedFramework,
    );
    const nextFocusIndex = Math.max(selectedOptionIndex, 0);
    focusFrameworkOption(nextFocusIndex);
    setFrameworkPickerOpen(true);
  }, [focusFrameworkOption, frameworkOptions, selectedFramework]);

  const closeFrameworkPicker = useCallback((restoreTriggerFocus: boolean) => {
    setFrameworkPickerOpen(false);
    if (!restoreTriggerFocus) return;
    window.requestAnimationFrame(() => {
      frameworkTriggerRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const chooseFramework = useCallback(
    (slug: string) => {
      setSelectedFramework(slug);
      setStoredFramework(slug);
      setSelectedIndex(0);
      closeFrameworkPicker(true);
    },
    [closeFrameworkPicker, setStoredFramework],
  );

  const onFrameworkOptionKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLButtonElement>,
      index: number,
      slug: string,
    ) => {
      if (event.nativeEvent.isComposing) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusFrameworkOption(Math.min(index + 1, frameworkOptions.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusFrameworkOption(Math.max(index - 1, 0));
      } else if (event.key === "Home") {
        event.preventDefault();
        focusFrameworkOption(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusFrameworkOption(frameworkOptions.length - 1);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        chooseFramework(slug);
      } else if (event.key === "Tab") {
        window.requestAnimationFrame(() => {
          closeFrameworkPicker(false);
        });
      }
    },
    [
      chooseFramework,
      closeFrameworkPicker,
      focusFrameworkOption,
      frameworkOptions.length,
    ],
  );

  const trimmedQuery = query.trim();
  const results = useMemo(
    () =>
      trimmedQuery
        ? buildSearchResults({
            query: trimmedQuery,
            pages: SEARCH_PAGES,
            registryData,
            selectedFramework,
            shellHost,
            activeFrontend,
          })
        : buildQuickSearchResults(SEARCH_PAGES, shellHost),
    [activeFrontend, registryData, selectedFramework, shellHost, trimmedQuery],
  );
  const resultGroups = useMemo(() => groupSearchResults(results), [results]);
  const orderedResults = useMemo(
    () => resultGroups.flatMap((group) => group.items),
    [resultGroups],
  );

  useEffect(() => {
    setSelectedIndex((index) =>
      orderedResults.length === 0
        ? 0
        : Math.min(index, orderedResults.length - 1),
    );
  }, [orderedResults.length]);

  const navigateTo = useCallback(
    (href: string) => {
      setFrameworkPickerOpen(false);
      navigateToSearchHref(href, {
        push: (destination) => router.push(destination),
        assign: (destination) => window.location.assign(destination),
      });
      onOpenChange(false);
    },
    [onOpenChange, router],
  );

  const onInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return;

      if (event.key === "ArrowDown") {
        if (orderedResults.length === 0) return;
        event.preventDefault();
        setSelectedIndex((index) =>
          Math.min(index + 1, orderedResults.length - 1),
        );
      } else if (event.key === "ArrowUp") {
        if (orderedResults.length === 0) return;
        event.preventDefault();
        setSelectedIndex((index) => Math.max(index - 1, 0));
      } else if (event.key === "Home") {
        if (orderedResults.length === 0) return;
        event.preventDefault();
        setSelectedIndex(0);
      } else if (event.key === "End") {
        if (orderedResults.length === 0) return;
        event.preventDefault();
        setSelectedIndex(orderedResults.length - 1);
      } else if (event.key === "Enter") {
        const result = orderedResults[selectedIndexRef.current];
        if (!result) return;
        event.preventDefault();
        navigateTo(result.href);
      }
    },
    [navigateTo, orderedResults],
  );

  const registryLoading = !registryData && !registryError;
  const hasFrameworkPicker = frameworkOptions.length > 0;
  const activeResult = orderedResults[selectedIndex];
  const activeDescendant = activeResult
    ? `${listboxId}-option-${selectedIndex}`
    : undefined;

  return (
    <SearchDialog
      open={open}
      onOpenChange={onOpenChange}
      search={query}
      onSearchChange={(value) => {
        setQuery(value);
        setSelectedIndex(0);
      }}
      isLoading={registryLoading}
    >
      <SearchDialogOverlay
        data-testid="search-overlay"
        className="z-[200] bg-[var(--overlay-backdrop)] backdrop-blur-sm motion-reduce:animate-none"
      />
      <SearchDialogContent
        aria-label="Search documentation"
        onEscapeKeyDown={(event) => {
          if (!frameworkPickerOpen) return;
          event.preventDefault();
          closeFrameworkPicker(true);
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          window.requestAnimationFrame(() => {
            inputRef.current?.focus({ preventScroll: true });
            inputRef.current?.select();
          });
        }}
        onCloseAutoFocus={(event) => {
          if (!restoreFocus) return;
          event.preventDefault();
          restoreFocus();
        }}
        className="shell-docs-radius-surface top-[12%] z-[201] w-[calc(100%-2rem)] max-w-2xl overflow-visible border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text)] shadow-[var(--shadow-modal)] md:top-[12%] motion-reduce:animate-none"
      >
        <div
          aria-hidden="true"
          className="h-px bg-gradient-to-r from-transparent via-[var(--accent)]/70 to-transparent"
        />
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4">
          <Search
            className="h-4 w-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Search documentation"
            aria-controls={listboxId}
            aria-expanded={open}
            aria-autocomplete="list"
            aria-activedescendant={activeDescendant}
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search docs, API reference, integrations..."
            className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="shell-docs-radius-control inline-flex h-10 w-10 items-center justify-center text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] motion-reduce:transition-none"
            aria-label="Close search"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="relative flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-elevated)]/45 px-5 py-2.5 text-[12px] text-[var(--text-muted)]">
          <span className="shrink-0">Searching docs for</span>
          <div className="relative min-w-0">
            <button
              ref={frameworkTriggerRef}
              type="button"
              disabled={!hasFrameworkPicker}
              onClick={() => {
                if (frameworkPickerOpen) {
                  closeFrameworkPicker(true);
                } else {
                  openFrameworkPicker();
                }
              }}
              onKeyDown={(event) => {
                if (
                  !frameworkPickerOpen &&
                  (event.key === "ArrowDown" || event.key === "ArrowUp")
                ) {
                  event.preventDefault();
                  openFrameworkPicker();
                }
              }}
              className="shell-docs-radius-control inline-flex h-8 max-w-[min(56vw,220px)] items-center justify-between gap-2 border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 text-left text-xs font-semibold text-[var(--text)] outline-none transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-hover)] focus-visible:border-[var(--accent)] disabled:opacity-60 motion-reduce:transition-none"
              aria-haspopup="listbox"
              aria-expanded={frameworkPickerOpen}
              aria-label={`Choose docs framework. Currently ${
                selectedFrameworkOption?.name ?? "loading frameworks"
              }`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {selectedFrameworkOption ? (
                  <FrameworkLogo
                    slug={selectedFrameworkOption.slug}
                    fallbackSrc={selectedFrameworkOption.logo}
                    className="shrink-0 text-[var(--accent)]"
                    size={14}
                  />
                ) : null}
                <span className="truncate">
                  {selectedFrameworkOption?.name ?? "Loading frameworks"}
                </span>
              </span>
              <ChevronDown
                className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"
                aria-hidden="true"
              />
            </button>

            {frameworkPickerOpen && hasFrameworkPicker ? (
              <div
                role="listbox"
                aria-label="Docs framework"
                className="shell-docs-radius-surface absolute left-0 top-full z-10 mt-2 max-h-[280px] w-[min(360px,calc(100vw-3rem))] overflow-y-auto border border-[var(--border)] bg-[var(--bg-surface)] p-1.5 shadow-[var(--shadow-panel)]"
              >
                {frameworkOptions.map((option, index) => {
                  const selected = option.slug === selectedFramework;
                  return (
                    <button
                      ref={(node) => {
                        frameworkOptionRefs.current[index] = node;
                      }}
                      key={option.slug}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      tabIndex={index === frameworkFocusIndex ? 0 : -1}
                      onClick={() => chooseFramework(option.slug)}
                      onFocus={() => setFrameworkFocusIndex(index)}
                      onKeyDown={(event) =>
                        onFrameworkOptionKeyDown(event, index, option.slug)
                      }
                      className={`shell-docs-radius-control flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors motion-reduce:transition-none ${
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
                      {selected ? (
                        <Check
                          className="h-4 w-4 shrink-0 text-[var(--accent)]"
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        <div
          id={listboxId}
          role="listbox"
          aria-label="Search results"
          className="max-h-[390px] overflow-y-auto p-2"
        >
          {resultGroups.map((group) => (
            <div
              key={group.label}
              role="group"
              aria-label={group.label}
              className="not-last:mb-2"
            >
              <div className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
                {group.label}
              </div>
              {group.items.map((result) => {
                const index = orderedResults.findIndex(
                  (item) => item.href === result.href,
                );
                const selected = index === selectedIndex;
                return (
                  <button
                    ref={(node) => {
                      resultOptionRefs.current[index] = node;
                    }}
                    key={result.id}
                    id={`${listboxId}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    tabIndex={-1}
                    className={`shell-docs-radius-control flex w-full items-center gap-3 px-3 py-3 text-left transition-colors motion-reduce:transition-none ${
                      selected
                        ? "bg-[var(--bg-elevated)]"
                        : "hover:bg-[var(--bg-hover)]"
                    }`}
                    onClick={() => navigateTo(result.href)}
                    onPointerMove={() => setSelectedIndex(index)}
                  >
                    <span className="w-16 shrink-0 font-mono text-[10px] uppercase text-[var(--text-faint)]">
                      {formatType(result.type)}
                    </span>
                    <ResultText result={result} />
                    <ArrowRight
                      className={`h-4 w-4 shrink-0 transition-colors motion-reduce:transition-none ${
                        selected
                          ? "text-[var(--accent)]"
                          : "text-[var(--text-faint)]"
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {registryLoading ? (
          <div
            role="status"
            aria-live="polite"
            className="px-5 py-2 text-[11px] text-[var(--text-faint)]"
          >
            Loading integration results…
          </div>
        ) : (
          <>
            {trimmedQuery && results.length === 0 ? (
              <div
                role="status"
                aria-live="polite"
                className="px-5 py-8 text-center text-[13px] text-[var(--text-muted)]"
              >
                No results for “{trimmedQuery}”. Try a different term or browse
                the quick destinations.
              </div>
            ) : null}
            {registryError ? (
              <div
                role="status"
                aria-live="polite"
                className="px-5 py-2 text-[11px] text-[var(--text-muted)]"
              >
                Integration results are unavailable. Documentation search still
                works.
              </div>
            ) : null}
          </>
        )}
      </SearchDialogContent>
    </SearchDialog>
  );
}

function ResultText({ result }: { result: SearchResult }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-[13px] font-semibold text-[var(--text)]">
          {result.title}
        </span>
        {result.section ? (
          <span className="hidden shrink-0 text-[11px] font-normal text-[var(--text-faint)] sm:inline">
            {result.section}
          </span>
        ) : null}
      </div>
      <div className="truncate text-[11px] text-[var(--text-muted)]">
        {result.subtitle}
      </div>
      {result.frameworkName ? (
        <div className="mt-1 text-[10px] font-medium text-[var(--accent)]">
          {result.frameworkName}
          {result.frameworkCount && result.frameworkCount > 1
            ? ` selected from ${result.frameworkCount} backends`
            : " selected"}
        </div>
      ) : null}
    </div>
  );
}

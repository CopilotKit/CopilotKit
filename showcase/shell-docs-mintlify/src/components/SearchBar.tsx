import { useState, useEffect, useCallback } from 'react';
import {
  SearchButton,
  SearchProvider,
  useSearch,
  type SearchResult,
  Icon,
} from '@mintlify/components';
import { navigate } from 'astro:transitions/client';
import { useDebouncedCallback } from 'use-debounce';
import { type DecoratedNavigationPage } from '@mintlify/models';
import { resolveIntegration, stripIntegrationPrefix } from '../lib/integration';

const SEARCH_OPEN_EVENT = 'open-search';

export function openSearch() {
  window.dispatchEvent(new CustomEvent(SEARCH_OPEN_EVENT));
}

function CompactSearchButton() {
  const search = useSearch();
  return (
    <button
      type="button"
      aria-label="Search"
      title="Search (⌘K)"
      onClick={() => search?.open()}
      className="flex items-center justify-center w-9 h-9 rounded-[0.85rem] text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800 transition-colors"
    >
      <Icon icon="search" iconLibrary="lucide" size={18} color="currentColor" />
    </button>
  );
}

function SearchEventListener() {
  const search = useSearch();

  useEffect(() => {
    const handleOpen = () => search?.open();
    window.addEventListener(SEARCH_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(SEARCH_OPEN_EVENT, handleOpen);
  }, [search]);

  return null;
}

const SUBDOMAIN = import.meta.env.PUBLIC_MINTLIFY_SUBDOMAIN;
const API_KEY = import.meta.env.PUBLIC_MINTLIFY_ASSISTANT_KEY;

const normalizePath = (path: string | undefined): string => {
  if (!path) return '/';

  let normalized = path.startsWith('/') ? path : `/${path}`;
  if (normalized.endsWith('index')) {
    normalized = normalized.replace('index', '');
  }
  return normalized;
};

const SEARCH_HISTORY_KEY = 'mintlify-search-history';
const MAX_HISTORY_ITEMS = 5;
const DEBOUNCE_DELAY_IN_MS = 100;

type ApiSearchResult = {
  content: string;
  path: string;
  metadata: DecoratedNavigationPage;
};

interface SearchBarProps {
  /**
   * `full` (default) renders Mintlify's wide search pill with placeholder + ⌘K.
   * `icon` renders a compact 32×32 magnifying-glass button — used in the
   * single-row header where the pill would compete with centered nav for space.
   */
  variant?: 'full' | 'icon';
}

export function SearchBar({ variant = 'full' }: SearchBarProps = {}) {
  const [mounted, setMounted] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<SearchResult[]>([]);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(SEARCH_HISTORY_KEY);
      if (stored) {
        setRecentSearches(JSON.parse(stored));
      }
    } catch (err) {
      console.error('Failed to load search history:', err);
    }
  }, []);

  const performSearch = useCallback(async (searchQuery: string) => {
    setIsLoading(true);

    try {
      const response = await fetch(
        `https://api.mintlify.com/discovery/v1/search/${SUBDOMAIN}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }),
          },
          body: JSON.stringify({
            query: searchQuery,
            pageSize: 10,
            filter: {
              language: 'en',
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = (await response.json()) as ApiSearchResult[];

      // Dedupe alias variants of the same canonical page. Each universal page
      // is mirrored under every integration prefix (e.g. /quickstart,
      // /langgraph/quickstart, /adk/quickstart, ...) and Mintlify's discovery
      // API indexes each URL separately. Group by canonical slug and prefer
      // the variant whose path matches the integration the reader is on, so
      // clicking a result lands them on the right track.
      const currentIntegration = resolveIntegration(window.location.pathname);
      const dedupedByCanonical = new Map<string, ApiSearchResult>();
      for (const item of data) {
        const canonicalSlug = stripIntegrationPrefix(item.path || '/');
        const existing = dedupedByCanonical.get(canonicalSlug);
        if (!existing) {
          dedupedByCanonical.set(canonicalSlug, item);
          continue;
        }
        const existingIntegration = resolveIntegration(existing.path || '/');
        const itemIntegration = resolveIntegration(item.path || '/');
        if (
          itemIntegration === currentIntegration &&
          existingIntegration !== currentIntegration
        ) {
          dedupedByCanonical.set(canonicalSlug, item);
        }
      }

      const transformedResults: SearchResult[] = Array.from(
        dedupedByCanonical.values(),
      ).map(
        (item: ApiSearchResult, index: number) => {
          const pathSegments = item.path
            ? item.path
                .split('/')
                .map(
                  (segment: string) =>
                    segment.charAt(0).toUpperCase() + segment.slice(1),
                )
            : [];

          return {
            id: item.path || `result-${index}`,
            header:
              item.metadata?.title ||
              pathSegments[pathSegments.length - 1] ||
              'Untitled',
            content: item.metadata?.description || item.content || '',
            link: normalizePath(item.path),
            metadata: {
              ...item.metadata,
              breadcrumbs: pathSegments,
              iconName: item.metadata.icon || 'hashtag',
            },
          };
        },
      );

      setResults(transformedResults);
    } catch (err) {
      console.error('Search error:', err);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const debouncedSearch = useDebouncedCallback((searchQuery: string) => {
    performSearch(searchQuery);
  }, DEBOUNCE_DELAY_IN_MS);

  const handleSearch = useCallback(
    (searchQuery: string) => {
      if (!searchQuery.trim()) {
        debouncedSearch.cancel();
        setResults([]);
        setIsLoading(false);
        return;
      }

      setResults([]);
      setIsLoading(true);
      debouncedSearch(searchQuery);
    },
    [debouncedSearch],
  );

  const handleSelectResult = (result: SearchResult) => {
    navigate(result.link);

    try {
      const newHistory = [
        result,
        ...recentSearches.filter((item) => item.id !== result.id),
      ].slice(0, MAX_HISTORY_ITEMS);

      setRecentSearches(newHistory);
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(newHistory));
    } catch (err) {
      console.error('Failed to save search history:', err);
    }
  };

  const addIconsToResults = (items: SearchResult[]): SearchResult[] => {
    return items.map((item) => {
      const iconName = item.metadata?.iconName || 'hashtag';
      return {
        ...item,
        icon: <Icon icon={iconName} size={16} color="gray" />,
      };
    });
  };

  if (!mounted) {
    return variant === 'icon' ? null : <SearchButton />;
  }

  return (
    <SearchProvider
      searchProps={{
        onSearch: handleSearch,
        results: addIconsToResults(results),
        isLoading,
        onSelectResult: handleSelectResult,
        recentSearches: addIconsToResults(recentSearches),
      }}
    >
      <SearchEventListener />
      {variant === 'icon' ? <CompactSearchButton /> : <SearchButton />}
    </SearchProvider>
  );
}

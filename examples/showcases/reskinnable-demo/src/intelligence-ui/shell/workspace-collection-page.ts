import { useLocation, useSearchParams } from './router';

/** The URL-backed page of a collection paged in the browser. */
export interface CollectionPage {
  /** The requested `?page=`, clamped to the pages that exist. */
  readonly page: number;
  /**
   * Moves to a page, keeping every other search parameter. Does nothing when
   * the URL already names that page, so a reset on every keystroke adds no
   * history entry.
   */
  readonly changePage: (page: number, replace?: boolean) => void;
  /** The link for a page, keeping other search parameters and the hash. */
  readonly hrefForPage: (page: number) => string;
}

/**
 * Read and change the `?page=` of a collection paged in the browser.
 *
 * @param total - Rows left after every filter.
 * @param pageSize - Rows per page.
 * @returns The current page, a page change, and each page's link.
 */
export function useCollectionPage(
  total: number,
  pageSize: number,
): CollectionPage {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = Number(searchParams.get('page') ?? '1');
  const withPage = (page: number): URLSearchParams => {
    const params = new URLSearchParams(searchParams);
    if (page <= 1) params.delete('page');
    else params.set('page', String(page));
    return params;
  };
  return {
    changePage: (page, replace = false) => {
      const next = withPage(page);
      if (next.toString() !== searchParams.toString())
        setSearchParams(next, { replace });
    },
    hrefForPage: (page) => {
      const params = withPage(page);
      return `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`;
    },
    page: Math.min(
      Math.max(1, Math.ceil(total / pageSize)),
      Number.isSafeInteger(requested) && requested > 0 ? requested : 1,
    ),
  };
}

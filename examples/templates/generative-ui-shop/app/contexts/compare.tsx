import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

type CompareContextValue = {
  /** The current set of product IDs the customer is comparing, in insertion order. */
  ids: Array<string>;
  /** Toggle a product's membership in the compare list. */
  toggle: (id: string) => void;
  /** Add a product to the compare list (no-op if already present). */
  add: (id: string) => void;
  /** Remove a product from the compare list (no-op if not present). */
  remove: (id: string) => void;
  /** Whether a product is in the compare list. */
  has: (id: string) => boolean;
  /** Empty the compare list. */
  clear: () => void;
  /** Convenience accessor for `ids.length`. */
  count: number;
  /**
   * Whether the provider has finished reading localStorage. Use this to
   * avoid SSR/CSR mismatches — render a neutral state while `false`.
   */
  isHydrated: boolean;
};

const CompareContext = createContext<CompareContextValue | null>(null);

const STORAGE_KEY = "epicstore.compare.v1";

export function CompareProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<Array<string>>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setIds(parsed.filter((x): x is string => typeof x === "string"));
        }
      }
    } catch {
      // ignore — fall back to empty list
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      // ignore — storage may be unavailable
    }
  }, [ids, isHydrated]);

  const add = useCallback((id: string) => {
    setIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const remove = useCallback((id: string) => {
    setIds((prev) => prev.filter((existing) => existing !== id));
  }, []);

  const toggle = useCallback((id: string) => {
    setIds((prev) =>
      prev.includes(id)
        ? prev.filter((existing) => existing !== id)
        : [...prev, id],
    );
  }, []);

  const clear = useCallback(() => setIds([]), []);

  const value = useMemo<CompareContextValue>(
    () => ({
      ids,
      toggle,
      add,
      remove,
      has: (id) => ids.includes(id),
      clear,
      count: ids.length,
      isHydrated,
    }),
    [ids, toggle, add, remove, clear, isHydrated],
  );

  return (
    <CompareContext.Provider value={value}>{children}</CompareContext.Provider>
  );
}

export function useCompare() {
  const ctx = useContext(CompareContext);
  if (!ctx) throw new Error("useCompare must be used inside <CompareProvider>");
  return ctx;
}

"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export interface FilterState {
  /** Free-text search across integration + feature names. Empty = no filter. */
  q: string;
  /** Selected languages; empty array = show all. */
  languages: string[];
  /** Selected integration categories; empty = show all. */
  integrationCategories: string[];
  /** Selected feature categories; empty = show all. */
  featureCategories: string[];
  /** When true, hide any feature row that has any non-green cell among visible integrations. */
  onlyGreen: boolean;
}

export interface FilterActions {
  setSearch: (q: string) => void;
  toggleLanguage: (lang: string) => void;
  toggleIntegrationCategory: (cat: string) => void;
  toggleFeatureCategory: (cat: string) => void;
  setOnlyGreen: (on: boolean) => void;
  clearAll: () => void;
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

export function useFilterState(): FilterState & FilterActions {
  const router = useRouter();
  const params = useSearchParams();

  const state: FilterState = useMemo(
    () => ({
      q: params.get("q") ?? "",
      languages: parseList(params.get("lang")),
      integrationCategories: parseList(params.get("ic")),
      featureCategories: parseList(params.get("fc")),
      onlyGreen: params.get("green") === "1",
    }),
    [params],
  );

  const write = useCallback(
    (
      next: Partial<
        Record<"q" | "lang" | "ic" | "fc" | "green", string | null>
      >,
    ) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === "" || v === undefined) sp.delete(k);
        else sp.set(k, v);
      }
      const qs = sp.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [params, router],
  );

  const setSearch = useCallback(
    (q: string) => write({ q: q || null }),
    [write],
  );

  const toggleLanguage = useCallback(
    (lang: string) =>
      write({ lang: toggle(state.languages, lang).join(",") || null }),
    [state.languages, write],
  );

  const toggleIntegrationCategory = useCallback(
    (cat: string) =>
      write({ ic: toggle(state.integrationCategories, cat).join(",") || null }),
    [state.integrationCategories, write],
  );

  const toggleFeatureCategory = useCallback(
    (cat: string) =>
      write({ fc: toggle(state.featureCategories, cat).join(",") || null }),
    [state.featureCategories, write],
  );

  const setOnlyGreen = useCallback(
    (on: boolean) => write({ green: on ? "1" : null }),
    [write],
  );

  const clearAll = useCallback(() => {
    router.replace("?", { scroll: false });
  }, [router]);

  return {
    ...state,
    setSearch,
    toggleLanguage,
    toggleIntegrationCategory,
    toggleFeatureCategory,
    setOnlyGreen,
    clearAll,
  };
}

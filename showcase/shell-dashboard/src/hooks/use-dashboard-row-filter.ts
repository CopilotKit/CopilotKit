"use client";

import { useEffect, useMemo, useState } from "react";
import { getFeatures } from "@/lib/registry";
import { parseDashboardRowFilter } from "@/lib/dashboard-row-filter";
import type { DashboardRowFilter } from "@/lib/dashboard-row-filter";

function currentSearch(): string {
  if (typeof window === "undefined") return "";
  return window.location.search;
}

export function useDashboardRowFilter(): DashboardRowFilter {
  const availableRows = useMemo(
    () => getFeatures().map((feature) => feature.id),
    [],
  );
  const [search, setSearch] = useState(currentSearch);

  useEffect(() => {
    const update = () => setSearch(currentSearch());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  return useMemo(
    () => parseDashboardRowFilter(search, availableRows),
    [availableRows, search],
  );
}

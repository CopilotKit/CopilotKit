"use client";

import { createContext, useContext, type ReactNode } from "react";
import { PRODUCTION_SITE_HOSTS, type SiteHosts } from "@/lib/site-hosts";

// This deployment's site hosts for client components. The `(d)` layout reads
// them on the server (src/lib/runtime-config.ts) and provides them here;
// outside it, they're production's.

const SiteHostsContext = createContext<SiteHosts>(PRODUCTION_SITE_HOSTS);

export function SiteHostsProvider({
  hosts,
  children,
}: {
  hosts: SiteHosts;
  children: ReactNode;
}) {
  return <SiteHostsContext value={hosts}>{children}</SiteHostsContext>;
}

export function useSiteHosts(): SiteHosts {
  return useContext(SiteHostsContext);
}

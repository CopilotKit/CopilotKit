"use client";

import type { ReactNode } from "react";
import { TooltipProvider } from "@cloudflare/kumo";

/** The providers that the Kumo components need, around the /kumo pages. */
export function KumoProviders({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

"use client";

import type { ReactNode } from "react";
import { TooltipProvider } from "@cloudflare/kumo";
import { ShikiProvider } from "@cloudflare/kumo/code";
import { SHIKI_LANGUAGES } from "./text";

/** The providers that the Kumo components need, around the /kumo pages. */
export function KumoProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <ShikiProvider engine="javascript" languages={SHIKI_LANGUAGES}>
        {children}
      </ShikiProvider>
    </TooltipProvider>
  );
}

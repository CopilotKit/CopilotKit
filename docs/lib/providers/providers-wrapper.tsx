"use client";

import React, { Suspense } from "react";
import { PostHogProvider } from "@/lib/providers/posthog-provider";
import { ScarfPixel } from "./scarf-pixel";
import { useRB2B } from "@/lib/hooks/use-rb2b";
import { useGoogleAnalytics } from "../hooks/use-google-analytics";
import { ThemeOverride } from "@/components/theme-override";

export function ProvidersWrapper({ children }: { children: React.ReactNode }) {
  useRB2B();
  useGoogleAnalytics();

  return (
    <Suspense fallback={null}>
      <PostHogProvider>{children}</PostHogProvider>
      <ThemeOverride />
      <ScarfPixel />
    </Suspense>
  );
}

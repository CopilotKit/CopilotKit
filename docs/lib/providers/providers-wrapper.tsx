"use client";

import React, { Suspense } from "react";
import { PostHogProvider } from "@/lib/providers/posthog-provider";
import { ScarfPixel } from "./scarf-pixel";
import { CopyTracker } from "./copy-tracker";
import { useGoogleAnalytics } from "../hooks/use-google-analytics";
import { ThemeOverride } from "@/components/theme-override";

export function ProvidersWrapper({ children }: { children: React.ReactNode }) {
  useGoogleAnalytics();

  return (
    <Suspense fallback={null}>
      <PostHogProvider>
        <CopyTracker />
        {children}
      </PostHogProvider>
      <ThemeOverride />
      <ScarfPixel />
    </Suspense>
  );
}

"use client";

import React from "react";
import { PostHogProvider } from "@/lib/providers/posthog-provider";
import { ClerkProvider } from "@clerk/nextjs";
import { ScarfPixel } from "./scarf-pixel";
import { useRB2B } from "@/lib/hooks/use-rb2b";

export function ProvidersWrapper({ children }: { children: React.ReactNode }) {
  useRB2B();

  return (
    <>
      <ClerkProvider publishableKey={process.env.CLERK_PUBLISHABLE_KEY}>
        <PostHogProvider>{children}</PostHogProvider>
        <ScarfPixel />
      </ClerkProvider>
    </>
  );
}

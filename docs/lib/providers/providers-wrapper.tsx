"use client";

import React from "react";
import { PostHogProvider } from "@/lib/providers/posthog-provider";
import { ClerkProvider } from "@clerk/clerk-react";
import { ScarfPixel } from "./scarf-pixel";
import { useRB2B } from "@/lib/hooks/use-rb2b";
import { useGoogleAnalytics } from "../hooks/use-google-analytics";

export function ProvidersWrapper({ children }: { children: React.ReactNode }) {
  useRB2B();
  useGoogleAnalytics();

  const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  const toRender = (
    <>
      <PostHogProvider>{children}</PostHogProvider>
      <ScarfPixel />
    </>
  );

  if (clerkPublishableKey) {
    <ClerkProvider publishableKey={clerkPublishableKey}>
      {toRender}
    </ClerkProvider>;
  } else {
    return toRender;
  }
}

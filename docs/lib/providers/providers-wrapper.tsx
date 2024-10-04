"use client";

import React, { Suspense } from "react";
import { PostHogProvider } from "@/lib/providers/posthog-provider";
import { ClerkProvider } from "@clerk/clerk-react";
import { ScarfPixel } from "./scarf-pixel";
import { useRB2B } from "@/lib/hooks/use-rb2b";

export function ProvidersWrapper({
  children,
  clerkPublishableKey,
}: {
  children: React.ReactNode;
  clerkPublishableKey: string;
}) {
  useRB2B();

  return (
    <>
      {/* <ClerkProvider publishableKey={clerkPublishableKey}> */}
        {/* <PostHogProvider>{children}</PostHogProvider> */}
        {children}
        <ScarfPixel />
      {/* </ClerkProvider> */}
    </>
  );
}

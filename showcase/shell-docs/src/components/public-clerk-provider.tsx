"use client";

import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";

const PublicClerkAvailableContext = createContext(true);

export function usePublicClerkAvailable(): boolean {
  return useContext(PublicClerkAvailableContext);
}

function getCurrentUrl(): string {
  return typeof window === "undefined" ? "/" : window.location.href;
}

export function PublicClerkProvider({
  children,
  publishableKey,
}: {
  children: ReactNode;
  publishableKey: string;
}) {
  const [afterSignOutUrl, setAfterSignOutUrl] = useState(getCurrentUrl);

  useEffect(() => {
    setAfterSignOutUrl(getCurrentUrl());
  }, []);

  if (!publishableKey) {
    return (
      <PublicClerkAvailableContext.Provider value={false}>
        {children}
      </PublicClerkAvailableContext.Provider>
    );
  }

  return (
    <PublicClerkAvailableContext.Provider value>
      <ClerkProvider
        publishableKey={publishableKey}
        afterSignOutUrl={afterSignOutUrl}
      >
        {children}
      </ClerkProvider>
    </PublicClerkAvailableContext.Provider>
  );
}

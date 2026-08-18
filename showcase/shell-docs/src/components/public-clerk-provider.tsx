"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";

const PublicClerkAvailableContext = createContext(true);
const PublicOpsUrlContext = createContext(
  "https://dashboard.operations.copilotkit.ai",
);

export function usePublicClerkAvailable(): boolean {
  return useContext(PublicClerkAvailableContext);
}

export function usePublicOpsUrl(): string {
  return useContext(PublicOpsUrlContext);
}

function getCurrentUrl(): string {
  return typeof window === "undefined" ? "/" : window.location.href;
}

export function PublicClerkProvider({
  children,
  opsPublicUrl,
  publishableKey,
}: {
  children: ReactNode;
  opsPublicUrl: string;
  publishableKey: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [afterSignOutUrl, setAfterSignOutUrl] = useState(getCurrentUrl);

  useEffect(() => {
    setAfterSignOutUrl(getCurrentUrl());
  }, [pathname, searchParams]);

  if (!publishableKey) {
    return (
      <PublicOpsUrlContext.Provider value={opsPublicUrl}>
        <PublicClerkAvailableContext.Provider value={false}>
          {children}
        </PublicClerkAvailableContext.Provider>
      </PublicOpsUrlContext.Provider>
    );
  }

  return (
    <PublicOpsUrlContext.Provider value={opsPublicUrl}>
      <PublicClerkAvailableContext.Provider value>
        <ClerkProvider
          publishableKey={publishableKey}
          afterSignOutUrl={afterSignOutUrl}
        >
          {children}
        </ClerkProvider>
      </PublicClerkAvailableContext.Provider>
    </PublicOpsUrlContext.Provider>
  );
}

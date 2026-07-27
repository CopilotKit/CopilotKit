"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { Component } from "react";
import { useEffect, useState } from "react";
import { usePublicClerkAvailable } from "./public-clerk-provider";

const DOCS_AUTH_ENTRY_BASE =
  "https://dashboard.operations.copilotkit.ai/?utm_source=docs&utm_medium=cta&utm_campaign=intelligence&utm_content=navbar";

function getCurrentDocsUrl(): string {
  return typeof window === "undefined"
    ? "https://docs.copilotkit.ai/"
    : window.location.href;
}

export function buildDocsAuthEntryHref(
  currentUrl = getCurrentDocsUrl(),
): string {
  const url = new URL(DOCS_AUTH_ENTRY_BASE);
  url.searchParams.set("redirect_url", currentUrl);
  return url.toString();
}

export function useDocsAuthEntryHref(): string {
  const [href, setHref] = useState(DOCS_AUTH_ENTRY_BASE);

  useEffect(() => {
    setHref(buildDocsAuthEntryHref());
  }, []);

  return href;
}

export function DocsPublicAuthControl({ fallback }: { fallback: ReactNode }) {
  const isPublicClerkAvailable = usePublicClerkAvailable();

  if (!isPublicClerkAvailable) return <>{fallback}</>;

  return (
    <DocsAuthFallbackBoundary fallback={fallback}>
      <ClerkDocsAuthControl fallback={fallback} />
    </DocsAuthFallbackBoundary>
  );
}

class DocsAuthFallbackBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) return <>{this.props.fallback}</>;

    return this.props.children;
  }
}

function ClerkDocsAuthControl({ fallback }: { fallback: ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded || !isSignedIn) return <>{fallback}</>;

  return (
    <div className="flex h-10 min-w-10 shrink-0 items-center justify-center">
      <UserButton />
    </div>
  );
}

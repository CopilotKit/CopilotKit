"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import { Brain, CreditCard } from "lucide-react";
import type { ReactNode } from "react";
import { Component, useEffect, useSyncExternalStore } from "react";
import { buildIntelligenceAuthEntryHref } from "@/lib/docs-cta-href";
import {
  usePublicClerkAvailable,
  usePublicOpsUrl,
} from "./public-clerk-provider";

export function buildDocsAuthEntryHref(
  opsPublicUrl = "https://dashboard.operations.copilotkit.ai",
): string {
  return buildIntelligenceAuthEntryHref(opsPublicUrl, { surface: "navbar" });
}

const RETURNING_VISITOR_KEY = "copilotkit-docs-signed-in-before";
const AUTH_HISTORY_CHANGED_EVENT = "copilotkit-docs-auth-history-changed";

function hasSignedInBefore(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(RETURNING_VISITOR_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribeToAuthHistory(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(AUTH_HISTORY_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(AUTH_HISTORY_CHANGED_EVENT, onChange);
  };
}

function rememberSignIn(): void {
  try {
    window.localStorage.setItem(RETURNING_VISITOR_KEY, "1");
    window.dispatchEvent(new Event(AUTH_HISTORY_CHANGED_EVENT));
  } catch {
    // Storage can be disabled; the auth control still works as a sign-up link.
  }
}

export function buildDocsAuthAction(
  hasSignedIn: boolean,
  opsPublicUrl = "https://dashboard.operations.copilotkit.ai",
): { label: "Sign in" | "Sign up"; href: string } {
  const href = new URL(buildDocsAuthEntryHref(opsPublicUrl));
  if (!hasSignedIn) href.pathname = "/sign-up";
  return {
    label: hasSignedIn ? "Sign in" : "Sign up",
    href: href.toString(),
  };
}

export function useDocsAuthAction() {
  const opsPublicUrl = usePublicOpsUrl();
  const returning = useSyncExternalStore(
    subscribeToAuthHistory,
    hasSignedInBefore,
    () => false,
  );
  return buildDocsAuthAction(returning, opsPublicUrl);
}

export function buildDocsUserMenuHref(
  path: "/intelligence" | "/pricing",
  opsPublicUrl = "https://dashboard.operations.copilotkit.ai",
): string {
  return new URL(path, opsPublicUrl).toString();
}

export function useDocsAuthEntryHref(): string {
  const opsPublicUrl = usePublicOpsUrl();
  return buildDocsAuthEntryHref(opsPublicUrl);
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

export class DocsAuthFallbackBoundary extends Component<
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
  const opsPublicUrl = usePublicOpsUrl();

  useEffect(() => {
    if (isLoaded && isSignedIn) rememberSignIn();
  }, [isLoaded, isSignedIn]);

  if (!isLoaded || !isSignedIn) return <>{fallback}</>;

  const intelligenceHref = buildDocsUserMenuHref("/intelligence", opsPublicUrl);
  const pricingHref = buildDocsUserMenuHref("/pricing", opsPublicUrl);

  return (
    <div className="flex h-10 min-w-10 shrink-0 items-center justify-center">
      <UserButton>
        <UserButton.MenuItems>
          <UserButton.Link
            href={intelligenceHref}
            label="Intelligence"
            labelIcon={<Brain size={16} aria-hidden="true" />}
          />
          <UserButton.Link
            href={pricingHref}
            label="Manage your plan"
            labelIcon={<CreditCard size={16} aria-hidden="true" />}
          />
        </UserButton.MenuItems>
      </UserButton>
    </div>
  );
}

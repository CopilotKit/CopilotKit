"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import { Brain, CreditCard } from "lucide-react";
import type { ReactNode } from "react";
import { Component } from "react";
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

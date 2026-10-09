import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

const clerkState = {
  isLoaded: true,
  isSignedIn: false,
  shouldThrow: false,
};

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

vi.mock("@clerk/nextjs", () => {
  const UserButton = Object.assign(
    ({ children }: { children?: ReactNode }) => (
      <div>
        <button type="button">Account menu</button>
        {children}
      </div>
    ),
    {
      MenuItems: ({ children }: { children?: ReactNode }) => children,
      Link: ({ href, label }: { href: string; label: string }) => (
        <a href={href}>{label}</a>
      ),
    },
  );

  return {
    useUser: () => {
      if (clerkState.shouldThrow) throw new Error("Clerk unavailable");

      return {
        isLoaded: clerkState.isLoaded,
        isSignedIn: clerkState.isSignedIn,
      };
    },
    UserButton,
  };
});

import { BrandNav, buildDocsAuthEntryHref } from "../brand-nav";
import {
  buildDocsUserMenuHref,
  DocsAuthFallbackBoundary,
} from "../docs-public-auth-control";
const docsPublicAuthControlSource = readFileSync(
  new URL("../docs-public-auth-control.tsx", import.meta.url),
  "utf8",
);

test("BrandNav keeps the public auth CTA while Clerk is loading", () => {
  clerkState.isLoaded = false;
  clerkState.isSignedIn = false;
  clerkState.shouldThrow = false;

  const markup = renderToStaticMarkup(<BrandNav />);

  expect(markup).toContain("Get CopilotKit Intelligence free");
  expect(markup).not.toContain("Account menu");
});

test("BrandNav uses the environment-specific Ops origin for user menu links", () => {
  expect(
    buildDocsUserMenuHref(
      "/intelligence",
      "https://dashboard.staging.operations.copilotkit.ai",
    ),
  ).toBe("https://dashboard.staging.operations.copilotkit.ai/intelligence");
  expect(
    buildDocsUserMenuHref(
      "/pricing",
      "https://dashboard.staging.operations.copilotkit.ai",
    ),
  ).toBe("https://dashboard.staging.operations.copilotkit.ai/pricing");
});

test("BrandNav sends public auth entry to Intelligence onboarding", () => {
  const href = buildDocsAuthEntryHref();

  expect(href).toBe(
    "https://dashboard.operations.copilotkit.ai/sign-in?post_auth_redirect=ready&utm_source=docs&utm_medium=cta&utm_campaign=intelligence&utm_content=navbar",
  );
});

test("BrandNav uses the environment-specific Ops origin for auth entry", () => {
  const href = buildDocsAuthEntryHref(
    "https://dashboard.staging.operations.copilotkit.ai",
  );

  expect(href).toBe(
    "https://dashboard.staging.operations.copilotkit.ai/sign-in?post_auth_redirect=ready&utm_source=docs&utm_medium=cta&utm_campaign=intelligence&utm_content=navbar",
  );
});

test("BrandNav keeps the public auth CTA when Clerk state cannot resolve", () => {
  const boundary = new DocsAuthFallbackBoundary({
    children: <button type="button">Account menu</button>,
    fallback: (
      <a href="https://dashboard.operations.copilotkit.ai/sign-in">
        Get CopilotKit Intelligence free
      </a>
    ),
  });
  boundary.state = DocsAuthFallbackBoundary.getDerivedStateFromError();

  const markup = renderToStaticMarkup(boundary.render());

  expect(markup).toContain("Get CopilotKit Intelligence free");
  expect(markup).not.toContain("Account menu");
});

test("BrandNav does not send public auth back to Docs", () => {
  expect(docsPublicAuthControlSource).not.toContain("redirect_url");
});

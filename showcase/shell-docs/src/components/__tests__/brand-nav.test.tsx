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

const brandNavSource = readFileSync(
  new URL("../brand-nav.tsx", import.meta.url),
  "utf8",
);
const docsPublicAuthControlSource = readFileSync(
  new URL("../docs-public-auth-control.tsx", import.meta.url),
  "utf8",
);
const mobileTopNavSource = readFileSync(
  new URL("../mobile-top-nav.tsx", import.meta.url),
  "utf8",
);
const globalsCss = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);

test("BrandNav opens docs from an Explore docs mega menu", () => {
  expect(brandNavSource).toContain("DocsMegaMenu");
  expect(brandNavSource).not.toContain('label: "Docs"');
  expect(brandNavSource).not.toContain('href: "/"');
});

test("BrandNav puts Intelligence next to Cookbook", () => {
  expect(brandNavSource).toContain('label: "Cookbook"');
  expect(brandNavSource).toContain('label: "Intelligence"');
  expect(brandNavSource).toContain("INTELLIGENCE_DOCS_HREF");
  expect(brandNavSource.indexOf('label: "Cookbook"')).toBeLessThan(
    brandNavSource.indexOf('label: "Intelligence"'),
  );
});

test("BrandNav keeps space between the center rail and search", () => {
  expect(brandNavSource).toContain("grid-cols-[auto_minmax(0,1fr)_auto]");
  expect(brandNavSource).toContain("gap-x-8");
  expect(brandNavSource).toContain("pl-4");
  expect(globalsCss).toContain(
    ".shell-docs-nav-link-idle.shell-docs-nav-link-intelligence:hover",
  );
});

test("BrandNav uses the docs grid desktop layout cap", () => {
  expect(brandNavSource).toContain("shell-docs-brand-nav-inner");
  expect(globalsCss).toContain(".shell-docs-brand-nav-inner");
  expect(globalsCss).toContain(
    "--shell-docs-layout-width: calc(97rem + 11px);",
  );
  expect(brandNavSource).not.toContain("max-w-[calc(");
  expect(brandNavSource).not.toContain("max-w-[1534px]");
});

test("BrandNav keeps the public auth CTA while Clerk is loading", () => {
  clerkState.isLoaded = false;
  clerkState.isSignedIn = false;
  clerkState.shouldThrow = false;

  const markup = renderToStaticMarkup(<BrandNav />);

  expect(markup).toContain("Get CopilotKit Intelligence free");
  expect(markup).not.toContain("Account menu");
});

test("MobileTopNav uses the CopilotKit Intelligence auth label", () => {
  expect(mobileTopNavSource).toContain("Get CopilotKit Intelligence free");
  expect(mobileTopNavSource).not.toContain("Get Enterprise Intelligence free");
});

test("BrandNav renders Clerk's user button in the desktop auth slot", () => {
  clerkState.isLoaded = true;
  clerkState.isSignedIn = true;
  clerkState.shouldThrow = false;

  const markup = renderToStaticMarkup(<BrandNav />);

  expect(markup).toContain("Account menu");
  expect(markup).toContain(
    'href="https://dashboard.operations.copilotkit.ai/intelligence"',
  );
  expect(markup).toContain("Intelligence");
  expect(markup).toContain(
    'href="https://dashboard.operations.copilotkit.ai/pricing"',
  );
  expect(markup).toContain("Manage your plan");
  expect(markup).not.toContain("Get CopilotKit Intelligence free");
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

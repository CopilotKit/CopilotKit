import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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

vi.mock("@clerk/nextjs", () => ({
  useUser: () => {
    if (clerkState.shouldThrow) throw new Error("Clerk unavailable");

    return {
      isLoaded: clerkState.isLoaded,
      isSignedIn: clerkState.isSignedIn,
    };
  },
  UserButton: () => <button type="button">Account menu</button>,
}));

import { BrandNav, buildDocsAuthEntryHref } from "../brand-nav";
import { DocsAuthFallbackBoundary } from "../docs-public-auth-control";

const brandNavSource = readFileSync(
  new URL("../brand-nav.tsx", import.meta.url),
  "utf8",
);
const docsPublicAuthControlSource = readFileSync(
  new URL("../docs-public-auth-control.tsx", import.meta.url),
  "utf8",
);
const globalsCss = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);

describe("BrandNav layout", () => {
  it("uses a CSS class for the same desktop layout cap as the docs grid", () => {
    expect(brandNavSource).toContain("shell-docs-brand-nav-inner");
    expect(globalsCss).toContain(".shell-docs-brand-nav-inner");
    expect(globalsCss).toContain(
      "--shell-docs-layout-width: calc(97rem + 11px);",
    );
    expect(brandNavSource).not.toContain("max-w-[calc(");
    expect(brandNavSource).not.toContain("max-w-[1534px]");
  });
});

describe("BrandNav auth control", () => {
  it("keeps the public auth CTA while Clerk is loading", () => {
    clerkState.isLoaded = false;
    clerkState.isSignedIn = false;
    clerkState.shouldThrow = false;

    const markup = renderToStaticMarkup(<BrandNav />);

    expect(markup).toContain("Get Enterprise Intelligence free");
    expect(markup).not.toContain("Account menu");
  });

  it("renders Clerk's user button in the existing desktop auth slot when signed in", () => {
    clerkState.isLoaded = true;
    clerkState.isSignedIn = true;
    clerkState.shouldThrow = false;

    const markup = renderToStaticMarkup(<BrandNav />);

    expect(markup).toContain("Account menu");
    expect(markup).not.toContain("Get Enterprise Intelligence free");
  });

  it("preserves the current docs URL when building the public auth entry URL", () => {
    const href = buildDocsAuthEntryHref(
      "https://docs.copilotkit.ai/channels?utm_source=website#install",
    );

    expect(href).toBe(
      "https://dashboard.operations.copilotkit.ai/?utm_source=docs&utm_medium=cta&utm_campaign=intelligence&utm_content=navbar&redirect_url=https%3A%2F%2Fdocs.copilotkit.ai%2Fchannels%3Futm_source%3Dwebsite%23install",
    );
  });

  it("uses the environment-specific Ops origin for auth entry", () => {
    const href = buildDocsAuthEntryHref(
      "https://docs.staging.copilotkit.ai/react?ref=nav#install",
      "https://dashboard.staging.operations.copilotkit.ai",
    );

    expect(href).toBe(
      "https://dashboard.staging.operations.copilotkit.ai/?utm_source=docs&utm_medium=cta&utm_campaign=intelligence&utm_content=navbar&redirect_url=https%3A%2F%2Fdocs.staging.copilotkit.ai%2Freact%3Fref%3Dnav%23install",
    );
  });

  it("keeps the public auth CTA when Clerk auth state cannot be resolved", () => {
    const boundary = new DocsAuthFallbackBoundary({
      children: <button type="button">Account menu</button>,
      fallback: (
        <a href="https://dashboard.operations.copilotkit.ai/sign-in">
          Get Enterprise Intelligence free
        </a>
      ),
    });
    boundary.state = DocsAuthFallbackBoundary.getDerivedStateFromError();

    const markup = renderToStaticMarkup(boundary.render());

    expect(markup).toContain("Get Enterprise Intelligence free");
    expect(markup).not.toContain("Account menu");
  });

  it("refreshes the auth href when the persistent nav route context changes", () => {
    expect(docsPublicAuthControlSource).toContain("usePathname()");
    expect(docsPublicAuthControlSource).toContain("useSearchParams()");
    expect(docsPublicAuthControlSource).toContain(
      "[opsPublicUrl, pathname, searchParams]",
    );
  });
});

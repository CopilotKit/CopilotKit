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

const brandNavSource = readFileSync(
  new URL("../brand-nav.tsx", import.meta.url),
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
});

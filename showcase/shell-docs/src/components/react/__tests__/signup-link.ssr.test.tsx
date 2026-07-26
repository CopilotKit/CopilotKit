import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SignupLink } from "../signup-link";
import { OpsPlatformCTA } from "../ops-platform-cta";
import { DocsTrackedCopy, DocsTrackedLink } from "../docs-conversion";

// These tests exercise the SSR path of "use client" components whose
// render-time bodies call `new URL(getRuntimeConfig().<url>)`. During
// SSR the client reader returns the SSR_PLACEHOLDER (no window); if any
// URL field there is the empty string, `new URL("")` throws and the
// whole server-rendered HTML response 500s. The placeholder MUST be a
// parseable URL.

function hrefFromStaticMarkup(html: string): string {
  const match = html.match(/href="([^"]+)"/);
  expect(match).not.toBeNull();
  return match![1].replaceAll("&amp;", "&");
}

describe("client component SSR safety (shell-docs)", () => {
  beforeEach(() => {
    // Force SSR path — getRuntimeConfig() in runtime-config.client.ts
    // returns the SSR_PLACEHOLDER when `typeof window === "undefined"`.
    delete (globalThis as { window?: unknown }).window;
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("SignupLink SSR-renders without throwing", () => {
    expect(() =>
      renderToStaticMarkup(<SignupLink surface="test">Sign up</SignupLink>),
    ).not.toThrow();
  });

  it("SignupLink SSR href parses as a URL", () => {
    const html = renderToStaticMarkup(
      <SignupLink surface="test">Sign up</SignupLink>,
    );
    expect(() => new URL(hrefFromStaticMarkup(html))).not.toThrow();
  });

  it("OpsPlatformCTA SSR-renders without throwing", () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(OpsPlatformCTA, {
          title: "Test",
          surface: "test-surface",
        }),
      ),
    ).not.toThrow();
  });

  it("OpsPlatformCTA SSR href parses as a URL", () => {
    const html = renderToStaticMarkup(
      React.createElement(OpsPlatformCTA, {
        title: "Test",
        surface: "test-surface",
      }),
    );
    expect(() => new URL(hrefFromStaticMarkup(html))).not.toThrow();
  });

  it("OpsPlatformCTA supports a custom href", () => {
    const html = renderToStaticMarkup(
      React.createElement(OpsPlatformCTA, {
        title: "Test",
        surface: "test-surface",
        href: "https://copilotkit.ai/talk-to-an-engineer",
        analyticsEvent: "talk_to_us_clicked",
      }),
    );
    const url = new URL(hrefFromStaticMarkup(html));
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://copilotkit.ai/talk-to-an-engineer",
    );
    expect(url.searchParams.get("utm_content")).toBe("test-surface");
  });

  it("DocsTrackedLink preserves its destination and analytics surface", () => {
    const html = renderToStaticMarkup(
      <DocsTrackedLink href="/threads-import" surface="test-surface">
        Synchronize history
      </DocsTrackedLink>,
    );
    expect(hrefFromStaticMarkup(html)).toBe("/threads-import");
    expect(html).toContain('data-docs-conversion-surface="test-surface"');
  });

  it("DocsTrackedCopy exposes its analytics surface", () => {
    const html = renderToStaticMarkup(
      <DocsTrackedCopy surface="test-copy-surface">
        <code>npx copilotkit@latest init</code>
      </DocsTrackedCopy>,
    );
    expect(html).toContain('data-docs-copy-surface="test-copy-surface"');
  });
});

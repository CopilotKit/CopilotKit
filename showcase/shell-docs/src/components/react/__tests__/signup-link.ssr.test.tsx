import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SignupLink } from "../signup-link";
import { OpsPlatformCTA } from "../ops-platform-cta";

// These tests exercise the SSR path of "use client" components whose
// render-time bodies call `new URL(getRuntimeConfig().<url>)`. During
// SSR the client reader returns the SSR_PLACEHOLDER (no window); if any
// URL field there is the empty string, `new URL("")` throws and the
// whole server-rendered HTML response 500s. The placeholder MUST be a
// parseable URL.

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
      renderToStaticMarkup(
        React.createElement(SignupLink, { surface: "test" }, "Sign up"),
      ),
    ).not.toThrow();
  });

  it("SignupLink SSR href parses as a URL", () => {
    const html = renderToStaticMarkup(
      React.createElement(SignupLink, { surface: "test" }, "Sign up"),
    );
    const match = html.match(/href="([^"]+)"/);
    expect(match).not.toBeNull();
    expect(() => new URL(match![1])).not.toThrow();
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
    const match = html.match(/href="([^"]+)"/);
    expect(match).not.toBeNull();
    expect(() => new URL(match![1])).not.toThrow();
  });
});

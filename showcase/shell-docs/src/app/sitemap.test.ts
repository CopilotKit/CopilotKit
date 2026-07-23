import { expect, test } from "vitest";

import sitemap from "./sitemap";

test("publishes the Angular feature catalog at its canonical URL", () => {
  const urls = sitemap().map((entry) => entry.url);

  expect(urls.some((url) => url.endsWith("/angular/features"))).toBe(true);
});

test("publishes every Angular task guide at its canonical URL", () => {
  const urls = sitemap().map((entry) => entry.url);
  const guidePaths = [
    "/angular/guides/chat-ui",
    "/angular/guides/frontend-tools-generative-ui",
    "/angular/guides/human-in-the-loop",
    "/angular/guides/shared-state",
    "/angular/guides/threads-memory-attachments-headless",
  ];

  for (const guidePath of guidePaths) {
    expect(urls.some((url) => url.endsWith(guidePath))).toBe(true);
  }
});

test("publishes shared Runtime and Intelligence docs once on the Angular surface", () => {
  const urls = sitemap().map((entry) => entry.url);

  expect(
    urls.some((url) => url.endsWith("/angular/backend/copilot-runtime")),
  ).toBe(true);
  expect(
    urls.some((url) => url.endsWith("/angular/premium/intelligence-platform")),
  ).toBe(true);
  expect(urls.some((url) => url.endsWith("/angular/auth"))).toBe(true);
  expect(
    urls.some((url) =>
      url.endsWith("/angular/langgraph-python/premium/intelligence-platform"),
    ),
  ).toBe(false);
});

test("publishes Angular backend roots and backend-owned pages without a full cross-product", () => {
  const urls = sitemap().map((entry) => entry.url);

  expect(urls.some((url) => url.endsWith("/angular/langgraph-python"))).toBe(
    true,
  );
  expect(
    urls.some((url) => url.endsWith("/angular/langgraph-python/quickstart")),
  ).toBe(true);
  expect(
    urls.some((url) => url.endsWith("/angular/langgraph-python/auth")),
  ).toBe(false);
});

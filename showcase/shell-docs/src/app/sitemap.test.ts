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

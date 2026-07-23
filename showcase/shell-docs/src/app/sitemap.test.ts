import { expect, test } from "vitest";

import sitemap from "./sitemap";

test("publishes the Angular feature catalog at its canonical URL", () => {
  const urls = sitemap().map((entry) => entry.url);

  expect(urls.some((url) => url.endsWith("/angular/features"))).toBe(true);
});

import { expect, test } from "vitest";

import { getAllLlmPages } from "../llm-text";

test("publishes canonical Angular URLs instead of source-tree URLs", () => {
  const urls = getAllLlmPages().map((page) => page.url);

  expect(urls).toEqual(
    expect.arrayContaining([
      "angular",
      "angular/features",
      "angular/using-these-docs",
    ]),
  );
  expect(urls.some((url) => url.startsWith("frontends/angular"))).toBe(false);
});

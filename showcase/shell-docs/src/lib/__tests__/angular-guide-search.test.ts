import { expect, test } from "vitest";

import searchIndex from "../../data/search-index.json";

test("indexes every Angular task guide at its canonical URL", () => {
  const hrefs = searchIndex.map((entry) => entry.href);

  expect(hrefs).toEqual(
    expect.arrayContaining([
      "/angular/guides/chat-ui",
      "/angular/guides/frontend-tools-generative-ui",
      "/angular/guides/human-in-the-loop",
      "/angular/guides/shared-state",
      "/angular/guides/threads-memory-attachments-headless",
    ]),
  );
  expect(
    hrefs.some((href) => href.startsWith("/docs/frontends/angular/guides/")),
  ).toBe(false);
});

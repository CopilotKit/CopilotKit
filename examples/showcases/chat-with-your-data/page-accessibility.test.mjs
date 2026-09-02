import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("./app/page.tsx", import.meta.url),
  "utf8",
);

test("announces the Suspense fallback while the dashboard loads", () => {
  const fallbackSource = pageSource.match(
    /fallback=\{([\s\S]*?)\n      \}\n    >/,
  )?.[1];

  assert.ok(fallbackSource, "expected the page to define a Suspense fallback");
  assert.match(fallbackSource, /role="status"/);
  assert.match(fallbackSource, /aria-live="polite"/);
  assert.match(fallbackSource, /className="sr-only">Loading dashboard/);
  assert.match(fallbackSource, /aria-hidden="true"/);
});

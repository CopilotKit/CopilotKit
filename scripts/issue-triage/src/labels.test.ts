import { test, expect } from "vitest";
import { resolveLabels } from "./labels";
test("keeps curated + prefixed, dedupes/lowercases", () =>
  expect(
    resolveLabels(["Bug", "bug", "area:Runtime", "severity:high", ""]),
  ).toEqual(["bug", "area:runtime", "severity:high"]));
test("drops unknown bare labels", () =>
  expect(resolveLabels(["wontfix-maybe", "needs-repro"])).toEqual([
    "needs-repro",
  ]));

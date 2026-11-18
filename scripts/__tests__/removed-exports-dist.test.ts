/**
 * Checks the stand-ins for the removed 1.x exports against the BUILT
 * packages. Build them first; CI runs this file after `pnpm run
 * check:packages`, which builds every package.
 */
import { describe, expect, it } from "vitest";
import {
  TYPE_FIXTURES,
  compareWithBuilds,
  typeFixtureProblems,
} from "../deprecations/removed-exports.mjs";

describe("the built packages", () => {
  it("export a stand-in for each removed name that the table lists, and only those", () => {
    expect(compareWithBuilds().problems).toEqual([]);
  });

  it.each(TYPE_FIXTURES)(
    "%s: each type error names the replacement",
    (fixture) => {
      expect(typeFixtureProblems(fixture)).toEqual([]);
    },
  );
});

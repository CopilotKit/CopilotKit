import * as semver from "semver";
import { describe, expect, it } from "vitest";
import { isStableVersion, isValidRange, satisfies } from "../semver.js";

// Every range and version is compared with the real `semver` package, so the
// feeds match the same SDK versions as they did with that dependency.
const ranges = [
  "",
  "*",
  "x",
  "1",
  "1.x",
  "1.2",
  "1.2.x",
  "1.2.*",
  "1.2.3",
  "=1.2.3",
  "v1.2.3",
  ">1",
  ">1.2",
  ">1.2.3",
  ">=1",
  ">=1.2",
  ">=1.70.0",
  "<1",
  "<1.2",
  "<1.70.2",
  "<=1",
  "<=1.2",
  "<=1.2.3",
  ">*",
  "<*",
  ">=*",
  "~1",
  "~1.2",
  "~1.70.1",
  "~0.5.1",
  "~>1.2.3",
  "~1.2.3-beta.2",
  "^1",
  "^1.2",
  "^1.73.0",
  "^0",
  "^0.0",
  "^0.2.3",
  "^0.0.3",
  "^0.0.x",
  "^1.2.3-beta.2",
  "^*",
  ">=1.70.1 <1.70.3",
  ">=1.70.1 <1.71.0",
  ">=1.77.0 <2.0.0",
  "> 1.2.3",
  ">= 1.2 < 2",
  "<1.0.0 || >=1.70.0",
  "^0.5.0 || ^1.70.0",
  "1.2 - 2.3.4",
  "1.2.3 - 2.3",
  "1.2.3 - 2",
  "1.2.3 - *",
  ">=1.77.0-beta.1",
  "1.77.0-beta.1 - 1.77.0",
  "not-a-range",
  "1.2.3.4",
  ">=a.b.c",
  "^01.2.3",
  "1.2.3 -2",
];

const versions = [
  "0.0.0",
  "0.0.3",
  "0.0.4",
  "0.2.3",
  "0.2.9",
  "0.3.0",
  "0.5.1",
  "0.5.2",
  "0.6.0",
  "1.0.0",
  "1.2.0",
  "1.2.3",
  "1.2.4",
  "1.3.0",
  "1.70.0",
  "1.70.1",
  "1.70.2",
  "1.70.3",
  "1.71.0",
  "1.73.3",
  "1.77.0",
  "1.77.5",
  "2.0.0",
  "2.3.4",
  "2.3.5",
  "2.4.0",
  "3.0.0",
  "1.2.3-beta.2",
  "1.2.3-beta.10",
  "1.70.2-beta.1",
  "1.77.0-beta.1",
  "1.77.0-beta.2",
  "2.0.0-rc.8",
  "v1.2.3",
  "=1.2.3",
  " 1.2.3 ",
  "1.2.3+build.5",
  "1.2",
  "01.2.3",
  "1.2.3-",
  "latest",
];

describe("semver", () => {
  it.each(ranges)("accepts the same ranges as semver: %j", (range) => {
    expect(isValidRange(range)).toBe(semver.validRange(range) !== null);
  });

  it.each(versions)("accepts the same stable versions as semver: %j", (v) => {
    expect(isStableVersion(v)).toBe(
      semver.valid(v) !== null && semver.prerelease(v) === null,
    );
  });

  it.each(ranges.filter((range) => semver.validRange(range) !== null))(
    "matches the same versions as semver for %j",
    (range) => {
      const matched = versions.filter((v) => satisfies(v, range));
      expect(matched).toEqual(
        versions.filter((v) => semver.satisfies(v, range)),
      );
    },
  );

  it("matches nothing for an invalid range or version", () => {
    expect(satisfies("1.2.3", "not-a-range")).toBe(false);
    expect(satisfies("latest", "*")).toBe(false);
  });
});

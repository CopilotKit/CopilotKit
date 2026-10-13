import { describe, expect, it } from "vitest";

import {
  aggregateCompatibilityScores,
  scoreCompatibilityVersion,
} from "./compatibility-score";

describe("scoreCompatibilityVersion", () => {
  it.each([
    ["1.2.10", "1.2.10", 100],
    ["1.2.9", "1.2.10", 99],
    ["1.2.5", "1.2.10", 95],
    ["1.2.4", "1.2.10", 89],
    ["1.2.0", "1.2.100", 89],
    ["1.2.99", "1.3.0", 89],
    ["1.2.99", "1.4.0", 80],
    ["1.2.99", "1.5.0", 70],
    ["1.2.99", "1.6.0", 60],
    ["1.2.99", "1.20.0", 60],
    ["1.99.99", "2.0.0", 20],
    ["1.99.99", "3.0.0", 5],
    ["1.99.99", "10.0.0", 5],
    ["0.2.10", "0.2.10", 100],
    ["0.2.5", "0.2.10", 95],
    ["0.2.4", "0.2.10", 89],
    ["0.2.99", "0.3.0", 20],
    ["0.2.99", "0.4.0", 5],
    ["0.2.99", "0.8.0", 5],
    ["0.99.99", "1.0.0", 20],
    ["1.2.9007199254740990", "1.2.9007199254740991", 99],
  ])(
    "scores stable %s against %s as %i",
    (runningVersion, latest, expected) => {
      expect(scoreCompatibilityVersion({ runningVersion, latest })).toBe(
        expected,
      );
    },
  );

  it.each([
    ["1.2.4", "1.2.3"],
    ["1.3.0", "1.2.99"],
    ["2.0.0", "1.99.99"],
    ["0.3.0", "0.2.99"],
  ])(
    "does not score stable %s newer than latest %s",
    (runningVersion, latest) => {
      expect(scoreCompatibilityVersion({ runningVersion, latest })).toBeNull();
    },
  );

  it.each([
    null,
    "",
    "1",
    "1.2",
    "1.2.3.4",
    "v1.2.3",
    "^1.2.3",
    "~1.2.3",
    ">=1.2.3",
    "1.2.x",
    "1.2.3 || 2.0.0",
    " 1.2.3",
    "1.2.3 ",
    "1.2.3\n",
    "1.2.3garbage",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "-1.2.3",
    "1.-2.3",
    "1.2.-3",
    "1.2.NaN",
    "1.2.Infinity",
    "1.2.1e2",
    "9007199254740992.2.3",
    "1.9007199254740992.3",
    "1.2.9007199254740992",
    "1.2.3-beta.1",
    "1.2.3-rc.1",
    "1.2.3-dev.1",
    "1.2.3+build.1",
    "1.2.3-preview.260911",
    "1.2.3-preview.260911.01",
    "1.2.3-preview.260911.-1",
    "1.2.3-preview.260911.9007199254740992",
    "1.2.3-preview.260911.1.extra",
    "1.2.3-preview.260911.1\n",
    "1.2.3-preview.26091.1",
    "1.2.3-preview.20260911.1",
    "1.2.3-preview.260000.1",
    "1.2.3-preview.261301.1",
    "1.2.3-preview.260231.1",
    "1.2.3-preview.260229.1",
    "1.2.3-Preview.260911.1",
  ])(
    "rejects missing or unsupported version %j in either position",
    (version) => {
      expect(
        scoreCompatibilityVersion({ runningVersion: version, latest: "1.2.3" }),
      ).toBeNull();
      expect(
        scoreCompatibilityVersion({ runningVersion: "1.2.3", latest: version }),
      ).toBeNull();
    },
  );

  describe("preview against stable latest", () => {
    it.each([
      ["1.2.10-preview.260911.1", "1.2.10", 100],
      ["1.2.9-preview.260911.1", "1.2.10", 99],
      ["1.2.5-preview.260911.1", "1.2.10", 95],
      ["1.2.4-preview.260911.1", "1.2.10", 89],
      ["1.2.10-preview.240229.0", "1.2.10", 100],
      ["1.2.99-preview.260911.1", "1.3.0", 89],
      ["1.99.99-preview.260911.1", "2.0.0", 20],
      ["0.2.99-preview.260911.1", "0.3.0", 20],
    ])(
      "scores base of %s against %s as %i",
      (runningVersion, latest, expected) => {
        const input = Object.freeze({ runningVersion, latest });

        expect(scoreCompatibilityVersion(input)).toBe(expected);
        expect(input.runningVersion).toBe(runningVersion);
      },
    );

    it.each([
      ["1.2.11-preview.260911.1", "1.2.10"],
      ["1.3.0-preview.260911.1", "1.2.99"],
      ["2.0.0-preview.260911.1", "1.99.99"],
    ])(
      "does not score newer preview base %s against %s",
      (runningVersion, latest) => {
        expect(
          scoreCompatibilityVersion({ runningVersion, latest }),
        ).toBeNull();
      },
    );
  });

  describe("preview against preview latest", () => {
    const previewTrains = Object.freeze([
      "1.preview.260901",
      "1.preview.260902",
      "1.preview.260904",
      "1.preview.260907",
      "1.preview.260911",
    ]);
    const latest = "1.0.0-preview.260911.7";

    it.each([
      ["1.0.0-preview.260907.99", 89],
      ["1.0.0-preview.260904.99", 80],
      ["1.0.0-preview.260902.99", 70],
      ["1.0.0-preview.260901.99", 60],
    ])(
      "counts distinct same-month trains for %s as %i",
      (runningVersion, expected) => {
        expect(
          scoreCompatibilityVersion({ runningVersion, latest, previewTrains }),
        ).toBe(expected);
      },
    );

    it("de-duplicates and orders supplied trains without mutating the inventory", () => {
      const inventory = Object.freeze([
        "2.preview.260909",
        "1.preview.260912",
        "1.preview.260911",
        "1.preview.260901",
        "1.preview.260909",
        "1.preview.260901",
        "0.preview.260909",
        "1.preview.260831",
        "1.preview.260909",
      ]);

      expect(
        scoreCompatibilityVersion({
          runningVersion: "1.0.0-preview.260901.1",
          latest,
          previewTrains: inventory,
        }),
      ).toBe(80);
      expect(inventory[0]).toBe("2.preview.260909");
    });

    it("counts release trains rather than elapsed calendar months", () => {
      expect(
        scoreCompatibilityVersion({
          runningVersion: "1.0.0-preview.250101.1",
          latest,
          previewTrains: ["1.preview.250101", "1.preview.260911"],
        }),
      ).toBe(89);
    });

    it.each([
      ["1.0.0-preview.260911.7", 100],
      ["1.0.0-preview.260911.6", 99],
      ["1.0.0-preview.260911.2", 95],
      ["1.0.0-preview.260911.1", 89],
    ])(
      "scores same-train revision lag for %s as %i",
      (runningVersion, expected) => {
        expect(
          scoreCompatibilityVersion({ runningVersion, latest, previewTrains }),
        ).toBe(expected);
      },
    );

    it.each([
      ["1.0.0-preview.260911.1", "2.0.0-preview.250101.1", 20],
      ["0.0.0-preview.260911.1", "2.0.0-preview.250101.1", 5],
    ])(
      "uses the major curve for %s against %s",
      (runningVersion, newerLatest, expected) => {
        expect(
          scoreCompatibilityVersion({
            runningVersion,
            latest: newerLatest,
            previewTrains: [
              "0.preview.260911",
              "1.preview.260911",
              "2.preview.250101",
            ],
          }),
        ).toBe(expected);
      },
    );

    it.each([
      undefined,
      [],
      ["1.preview.260907"],
      ["1.preview.260911"],
      ["260907", "260911"],
      ["2.preview.260907", "2.preview.260911"],
    ])("requires both full train IDs in inventory %j", (inventory) => {
      expect(
        scoreCompatibilityVersion({
          runningVersion: "1.0.0-preview.260907.1",
          latest,
          previewTrains: inventory,
        }),
      ).toBeNull();
    });

    it("requires inventory even for an exact preview version", () => {
      expect(
        scoreCompatibilityVersion({ runningVersion: latest, latest }),
      ).toBeNull();
    });

    it.each([
      ["2.0.0-preview.260901.1", "1.0.0-preview.260911.7"],
      ["1.0.0-preview.260912.1", "1.0.0-preview.260911.7"],
      ["1.0.0-preview.260911.8", "1.0.0-preview.260911.7"],
    ])(
      "does not score newer preview %s against %s",
      (runningVersion, olderLatest) => {
        expect(
          scoreCompatibilityVersion({
            runningVersion,
            latest: olderLatest,
            previewTrains: [
              ...previewTrains,
              "2.preview.260901",
              "1.preview.260912",
            ],
          }),
        ).toBeNull();
      },
    );

    it.each(["1.1.0-preview.260911.7", "1.0.1-preview.260911.7"])(
      "does not credit inconsistent exact-train/revision base %s",
      (runningVersion) => {
        expect(
          scoreCompatibilityVersion({ runningVersion, latest, previewTrains }),
        ).toBeNull();
      },
    );

    it("does not compare a stable running version to a preview latest", () => {
      expect(
        scoreCompatibilityVersion({
          runningVersion: "1.0.0",
          latest,
          previewTrains,
        }),
      ).toBeNull();
    });
  });
});

describe("aggregateCompatibilityScores", () => {
  it.each([
    [[], null],
    [[null], null],
    [[100, null], null],
    [[null, 100], null],
    [[100], 100],
    [[89, 70, 97], 70],
    [[89, 89], 89],
    [[5, 20, 100], 5],
  ])("aggregates required scores %j as %s", (scores, expected) => {
    expect(aggregateCompatibilityScores(Object.freeze(scores))).toBe(expected);
  });
});

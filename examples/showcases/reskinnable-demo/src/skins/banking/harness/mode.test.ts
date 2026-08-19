import { afterEach, describe, expect, it } from "vitest";
import { armAEnabled, harnessMode } from "./mode";

const set = (value: string | undefined) => {
  if (value === undefined) delete process.env.EXPENSE_HARNESS_MODE;
  else process.env.EXPENSE_HARNESS_MODE = value;
};

// Restore through `set`, NOT by assigning `original` back: on a checkout with no
// `.env` the original is `undefined`, and `process.env.X = undefined` writes the
// STRING "undefined" — after which every later harnessMode() in this process
// throws. Contained today only by vitest's per-file isolation.
const original = process.env.EXPENSE_HARNESS_MODE;
afterEach(() => set(original));

describe("harnessMode", () => {
  it("is off when unset", () => {
    set(undefined);
    expect(harnessMode()).toBe("off");
    expect(armAEnabled()).toBe(false);
  });

  it("enables the harness tool on tool", () => {
    set("tool");
    expect(harnessMode()).toBe("tool");
    expect(armAEnabled()).toBe(true);
  });

  it("throws on an unrecognised value rather than silently going off", () => {
    set("tooll");
    expect(() => harnessMode()).toThrow(/tooll/);
  });

  it.each(["factory", "both"])(
    "throws on the retired second-arm mode %s",
    (retired) => {
      // These were valid while a second arm existed. Treating them as `"tool"`
      // for compatibility would hide a stale `.env` instead of surfacing it, and
      // an operator who set `both` explicitly asked for something this build no
      // longer has — so the throw is the honest answer, and its message lists
      // what IS available.
      set(retired);
      expect(() => harnessMode()).toThrow(/off, tool/);
    },
  );
});

import { afterEach, describe, expect, it } from "vitest";
import { armAEnabled, armCEnabled, harnessMode } from "./mode";

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
    expect(armCEnabled()).toBe(false);
  });

  it("enables only arm A on tool", () => {
    set("tool");
    expect(armAEnabled()).toBe(true);
    expect(armCEnabled()).toBe(false);
  });

  it("enables only arm C on factory", () => {
    set("factory");
    expect(armAEnabled()).toBe(false);
    expect(armCEnabled()).toBe(true);
  });

  it("enables both on both", () => {
    set("both");
    expect(armAEnabled()).toBe(true);
    expect(armCEnabled()).toBe(true);
  });

  it("throws on an unrecognised value rather than silently going off", () => {
    set("tooll");
    expect(() => harnessMode()).toThrow(/tooll/);
  });
});

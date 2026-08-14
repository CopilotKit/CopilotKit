import { afterEach, describe, expect, it } from "vitest";
import { armAEnabled, armCEnabled, harnessMode } from "./mode";

const original = process.env.EXPENSE_HARNESS_MODE;
afterEach(() => {
  process.env.EXPENSE_HARNESS_MODE = original;
});

const set = (value: string | undefined) => {
  if (value === undefined) delete process.env.EXPENSE_HARNESS_MODE;
  else process.env.EXPENSE_HARNESS_MODE = value;
};

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

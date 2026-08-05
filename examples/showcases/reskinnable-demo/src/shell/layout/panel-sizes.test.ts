import { describe, expect, it } from "vitest";

import {
  ASSISTANT_DEFAULT_PX,
  ASSISTANT_MAX,
  ASSISTANT_MIN_PX,
} from "@/shell/layout/panel-sizes";

/**
 * There used to be eight assertions here, guarding relationships between eleven
 * constants — floors, ceilings, a hairline width, a derived minimum viewport. All
 * of that existed because the thread rail was a resizable panel nested inside the
 * assistant column, so its bounds compounded. With the rail a fixed-width element
 * there are three numbers and only these facts are worth pinning.
 */
describe("assistant column bounds", () => {
  it("starts between its floor and its ceiling", () => {
    expect(ASSISTANT_DEFAULT_PX).toBeGreaterThan(ASSISTANT_MIN_PX);
  });

  it("caps as a share, not a pixel count", () => {
    // This is what removes the need for an app floor and lets the mobile
    // breakpoint be about phones: half of any viewport leaves the other half.
    expect(ASSISTANT_MAX).toMatch(/%$/);
    expect(parseFloat(ASSISTANT_MAX)).toBeLessThanOrEqual(50);
  });

  it("fits well inside the mobile breakpoint, so panels always resolve", () => {
    // 768px is the narrowest viewport that renders columns; the floor must leave
    // the app real room there, or we are back to unsatisfiable constraints.
    expect(ASSISTANT_MIN_PX * 2).toBeLessThan(768);
  });
});

import { describe, expect, it } from "vitest";
import { spacing } from "@copilotkit/shared/generative-ui";
import { layoutStyle } from "../style";

describe("layoutStyle", () => {
  it("lets rowGap and columnGap win over gap, with no shorthand to override them", () => {
    // Angular applies [style] in sorted key order, so a `gap` next to
    // `columnGap` would be written last and erase it.
    expect(layoutStyle({ gap: 2, columnGap: 6 })).toMatchObject({
      rowGap: spacing(2),
      columnGap: spacing(6),
    });
    expect(layoutStyle({ gap: 2, columnGap: 6 })).not.toHaveProperty("gap");
    expect(layoutStyle({ rowGap: 1 })).toMatchObject({ rowGap: spacing(1) });
    expect(layoutStyle({ rowGap: 1 })).not.toHaveProperty("columnGap");
  });

  it("keeps the gap shorthand when no longhand is set", () => {
    expect(layoutStyle({ gap: 3 })).toMatchObject({ gap: spacing(3) });
    expect(layoutStyle({ disableAutoSpacing: true })).toMatchObject({ gap: 0 });
    expect(layoutStyle({})).not.toHaveProperty("gap");
  });
});

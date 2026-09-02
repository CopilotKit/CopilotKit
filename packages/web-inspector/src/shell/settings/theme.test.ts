import { describe, expect, it } from "vitest";

import { resolveColorSchemePreference } from "./theme.js";

describe("resolveColorSchemePreference", () => {
  it("uses an explicit persisted preference", () => {
    expect(
      resolveColorSchemePreference({ colorSchemePreference: "dark" }, "light"),
    ).toEqual({ colorScheme: "dark", hasExplicitColorScheme: true });
  });

  it("uses the system scheme when no explicit preference exists", () => {
    expect(resolveColorSchemePreference(null, "dark")).toEqual({
      colorScheme: "dark",
      hasExplicitColorScheme: false,
    });
  });

  it("does not treat the deprecated persisted default as an explicit choice", () => {
    expect(
      resolveColorSchemePreference({ colorScheme: "light" }, "dark"),
    ).toEqual({ colorScheme: "dark", hasExplicitColorScheme: false });
  });
});

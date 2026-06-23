import { describe, it, expect } from "vitest";
import { OPEN_GEN_UI_DESIGN_SYSTEM_CSS } from "../designSystemCss";

describe("OPEN_GEN_UI_DESIGN_SYSTEM_CSS", () => {
  it("contains the token, svg, and form layers", () => {
    expect(OPEN_GEN_UI_DESIGN_SYSTEM_CSS).toContain(
      "--color-background-primary",
    );
    expect(OPEN_GEN_UI_DESIGN_SYSTEM_CSS).toContain(
      "prefers-color-scheme: dark",
    );
    expect(OPEN_GEN_UI_DESIGN_SYSTEM_CSS).toContain(".c-purple");
    expect(OPEN_GEN_UI_DESIGN_SYSTEM_CSS).toContain('input[type="range"]');
    expect(OPEN_GEN_UI_DESIGN_SYSTEM_CSS).toContain("prefers-reduced-motion");
  });

  it("keeps the form focus ring visible in dark mode", () => {
    expect(OPEN_GEN_UI_DESIGN_SYSTEM_CSS).toContain(
      "rgba(255, 255, 255, 0.12)",
    );
  });
});

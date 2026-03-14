import { calculateToolbarViewportPosition } from "./positioning";

describe("calculateToolbarViewportPosition", () => {
  it("centers the toolbar below the selection when there is space", () => {
    const position = calculateToolbarViewportPosition({
      rect: { top: 100, left: 200, bottom: 120, width: 40 },
      toolbarWidth: 120,
      toolbarHeight: 50,
      scrollX: 0,
      scrollY: 0,
      viewportWidth: 800,
      viewportHeight: 600,
      viewportPadding: 6,
    });

    expect(position).toEqual({ top: 120, left: 160 });
  });

  it("keeps the toolbar inside the left viewport boundary", () => {
    const position = calculateToolbarViewportPosition({
      rect: { top: 100, left: 0, bottom: 120, width: 20 },
      toolbarWidth: 120,
      toolbarHeight: 50,
      scrollX: 50,
      scrollY: 0,
      viewportWidth: 800,
      viewportHeight: 600,
      viewportPadding: 6,
    });

    expect(position.left).toBe(56);
  });

  it("keeps the toolbar inside the right viewport boundary when scrolled", () => {
    const position = calculateToolbarViewportPosition({
      rect: { top: 100, left: 760, bottom: 120, width: 40 },
      toolbarWidth: 220,
      toolbarHeight: 50,
      scrollX: 120,
      scrollY: 0,
      viewportWidth: 800,
      viewportHeight: 600,
      viewportPadding: 6,
    });

    expect(position.left).toBe(694);
  });

  it("flips above the selection when the toolbar would overflow at the bottom", () => {
    const position = calculateToolbarViewportPosition({
      rect: { top: 560, left: 200, bottom: 580, width: 40 },
      toolbarWidth: 140,
      toolbarHeight: 80,
      scrollX: 0,
      scrollY: 0,
      viewportWidth: 800,
      viewportHeight: 600,
      viewportPadding: 6,
    });

    expect(position.top).toBe(480);
  });

  it("clamps to top padding when flipping above would overflow top", () => {
    const position = calculateToolbarViewportPosition({
      rect: { top: 20, left: 200, bottom: 40, width: 40 },
      toolbarWidth: 140,
      toolbarHeight: 80,
      scrollX: 0,
      scrollY: 0,
      viewportWidth: 800,
      viewportHeight: 100,
      viewportPadding: 6,
    });

    expect(position.top).toBe(6);
  });

  it("handles toolbar wider than viewport by pinning to viewport padding", () => {
    const position = calculateToolbarViewportPosition({
      rect: { top: 50, left: 80, bottom: 70, width: 20 },
      toolbarWidth: 500,
      toolbarHeight: 60,
      scrollX: 0,
      scrollY: 0,
      viewportWidth: 320,
      viewportHeight: 600,
      viewportPadding: 6,
    });

    expect(position.left).toBe(6);
  });
});

import { describe, expect, it, vi } from "vitest";
import { renderSurface } from "../../../__tests__/render";
import { preloadMathRenderer } from "..";
import { ui } from "./helpers";

// KaTeX loads on the first formula and its state stays in the module, so
// this file never preloads it: the tests run in order, from a failed load
// to a pending one that arrives.
const katex = vi.hoisted(() => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  return { failing: true, failure: new Error("chunk failed"), gate, release };
});
vi.mock("katex", async (importOriginal) => {
  if (katex.failing) throw katex.failure;
  await katex.gate;
  return importOriginal();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const renderMath = (value: string) =>
  renderSurface(ui, [{ id: "root", component: "Math", value }]);

describe("Math while KaTeX loads", () => {
  it("keeps the TeX source when the load fails, and handles the failure", async () => {
    // zone.js reports an unhandled rejection with console.error; vitest
    // itself logs the failure of the mock factory once.
    const consoleError = vi.spyOn(console, "error");
    try {
      const view = renderMath("x^2");
      await settle();
      view.detectChanges();
      const math = view.container.querySelector("[data-math]")!;
      expect(math.textContent).toBe("x^2");
      expect(math.querySelector(".katex")).toBeNull();
      const reported = consoleError.mock.calls.filter(
        ([error]) => error !== katex.failure,
      );
      expect(reported).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
    await expect(preloadMathRenderer()).rejects.toThrow();
  });

  it("shows the TeX source while KaTeX is pending, and typesets when it arrives", async () => {
    katex.failing = false;
    const view = renderMath("\\frac{a}{b}");
    await settle();
    view.detectChanges();
    const math = view.container.querySelector("[data-math]")!;
    expect(math.textContent).toBe("\\frac{a}{b}");
    expect(math.querySelector(".katex")).toBeNull();

    katex.release();
    await settle();
    view.detectChanges();
    expect(math.querySelector(".katex mfrac")).not.toBeNull();
  });
});

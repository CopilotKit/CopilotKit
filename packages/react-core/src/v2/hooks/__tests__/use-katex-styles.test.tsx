import { renderHook } from "../../../test-helpers/render-hook";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the katex CSS import globally
vi.mock("katex/dist/katex.min.css", () => ({}));

describe("useKatexStyles", () => {
  beforeEach(() => {
    // Reset module state (the singleton `injected` flag) between tests
    vi.resetModules();
  });

  async function loadHook() {
    const mod = await import("../useKatexStyles");
    return mod.useKatexStyles;
  }

  it("renders without error (dynamic import succeeds)", async () => {
    const useKatexStyles = await loadHook();

    expect(() => {
      renderHook(() => useKatexStyles());
    }).not.toThrow();
  });

  it("does not throw when katex CSS import fails", async () => {
    vi.doMock("katex/dist/katex.min.css", () => {
      throw new Error("CSS not found");
    });

    const useKatexStyles = await loadHook();

    expect(() => {
      renderHook(() => useKatexStyles());
    }).not.toThrow();
  });

  it("does not use a static katex CSS import in the component", async () => {
    // Regression guard: ensure the static import doesn't creep back.
    // Read the component source and verify no static katex CSS import.
    const fs = await import("fs");
    const path = await import("path");
    const componentPath = path.resolve(
      __dirname,
      "../../components/chat/CopilotChatAssistantMessage.tsx",
    );
    const source = fs.readFileSync(componentPath, "utf-8");

    // Should NOT have a static import of katex CSS
    expect(source).not.toMatch(
      /^import\s+['"]katex\/dist\/katex\.min\.css['"]/m,
    );
    // Should use the hook instead
    expect(source).toMatch(/useKatexStyles/);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { render } from "@testing-library/vue";

// Mock the katex CSS import globally so the dynamic import resolves cleanly
// in the test environment.
vi.mock("katex/dist/katex.min.css", () => ({}));

describe("useKatexStyles", () => {
  beforeEach(() => {
    // Reset module state (the singleton `injected` flag) between tests so
    // each case can exercise the dynamic-import branch.
    vi.resetModules();
  });

  async function loadHook() {
    const mod = await import("../use-katex-styles");
    return mod.useKatexStyles;
  }

  function mountWith(hook: () => void) {
    return render(
      defineComponent({
        setup() {
          hook();
          return () => h("div");
        },
      }),
    );
  }

  it("renders without error (dynamic import succeeds)", async () => {
    const useKatexStyles = await loadHook();

    expect(() => {
      mountWith(useKatexStyles);
    }).not.toThrow();
    await nextTick();
  });

  it("does not throw when katex CSS import fails", async () => {
    vi.doMock("katex/dist/katex.min.css", () => {
      throw new Error("CSS not found");
    });

    const useKatexStyles = await loadHook();

    expect(() => {
      mountWith(useKatexStyles);
    }).not.toThrow();
    await nextTick();
  });

  it("does not use a static katex CSS import in the component", async () => {
    // Regression guard: ensure the static import doesn't creep back.
    const fs = await import("fs");
    const path = await import("path");
    const componentPath = path.resolve(
      __dirname,
      "../../components/chat/CopilotChatAssistantMessage.vue",
    );
    const source = fs.readFileSync(componentPath, "utf-8");

    // Should NOT have a static import of katex CSS anywhere in the SFC.
    expect(source).not.toMatch(/import\s+['"]katex\/dist\/katex\.min\.css['"]/);
    // Should use the composable instead.
    expect(source).toMatch(/useKatexStyles/);
  });
});

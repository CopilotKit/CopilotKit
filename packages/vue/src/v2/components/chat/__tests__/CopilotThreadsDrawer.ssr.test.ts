import { describe, expect, it, vi } from "vitest";

// Regression guard: importing @copilotkit/vue must NOT eagerly evaluate the
// Lit <copilotkit-threads-drawer> element module. The element evaluates
// `class extends HTMLElement` at import time, which crashes Nuxt/Vite SSR
// (`HTMLElement is not defined`); it must be imported lazily (client-only,
// inside the wrapper's onMounted). If the wrapper ever regresses to a static
// top-level import, importing the package barrel would evaluate the mocked
// element module and flip the flag -> this test fails.
const { evaluated } = vi.hoisted(() => ({ evaluated: { current: false } }));
vi.mock("@copilotkit/web-components/threads-drawer", () => {
  evaluated.current = true;
  return {
    defineCopilotKitThreadsDrawer: () => {},
    COPILOTKIT_THREADS_DRAWER_TAG: "copilotkit-threads-drawer",
  };
});

describe("@copilotkit/vue SSR import safety", () => {
  it("does not eagerly evaluate the Lit element module when the package entry is imported", async () => {
    const mod = await import("../../../../index");
    expect(mod.CopilotThreadsDrawer).toBeDefined();
    expect(evaluated.current).toBe(false);
    // Importing the full @copilotkit/vue barrel is heavy; under the pre-commit
    // hook's full-suite parallel run the default 5s budget flakily times out.
  }, 30000);
});

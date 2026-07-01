// @vitest-environment node
import { describe, expect, it } from "vitest";

// Regression guard for the SSR crash where `@copilotkit/vue` eagerly imported
// the Lit `<copilotkit-threads-drawer>` element (which evaluates
// `class extends HTMLElement` at module load) and threw
// `HTMLElement is not defined` under Node/SSR — breaking every SSR consumer.
// In the node environment there is no DOM; importing the package entry (which
// re-exports CopilotThreadsDrawer) must NOT throw, and the Lit element must be
// imported only lazily/client-side.
describe("@copilotkit/vue SSR import safety", () => {
  it("imports the package entry under node (no DOM) without throwing", async () => {
    expect(typeof (globalThis as { HTMLElement?: unknown }).HTMLElement).toBe(
      "undefined",
    );
    const mod = await import("../../../../index");
    expect(mod.CopilotThreadsDrawer).toBeDefined();
  });
});

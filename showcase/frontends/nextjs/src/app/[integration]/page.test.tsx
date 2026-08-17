import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getIntegration } from "@/lib/integration-support";

import IntegrationIndex from "./page";

/**
 * Only `getIntegration` is wrapped, and it delegates to the real
 * implementation by default, so the two happy-path tests still run against
 * the real manifests on disk. The failure test overrides it for ONE call.
 *
 * The fault cannot be provoked with `SHOWCASE_INTEGRATIONS_DIR` instead: the
 * manifest tree is cached at module scope, so by the time a later test stubs
 * the env var the load has already succeeded.
 */
vi.mock("@/lib/integration-support", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/integration-support")>();
  return { ...actual, getIntegration: vi.fn(actual.getIntegration) };
});

async function render(integration: string): Promise<string> {
  const element = await IntegrationIndex({
    params: Promise.resolve({ integration }),
  });
  return renderToStaticMarkup(element);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/<integration> index", () => {
  it("lists the union of demo ids for a real integration", async () => {
    const html = await render("langgraph-python");
    expect(html).toContain("agentic-chat");
    expect(html).toContain("runnable demos supported by this backend");
  });

  it("renders the malformed state for an unknown integration", async () => {
    const html = await render("does-not-exist");
    expect(html).toContain("Invalid Showcase route");
  });

  /**
   * The regression this guard exists for: uncaught, a `ManifestLoadError`
   * became Next's generic 500 page ("Application error: a server-side
   * exception has occurred") and the actionable diagnosis was thrown away,
   * while the sibling routes (`demos/layout.tsx`, `demos/[demo]/page.tsx`)
   * rendered it in full for the SAME fault.
   */
  it("renders the manifest-load failure instead of throwing a 500", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getIntegration).mockImplementationOnce(() => {
      throw new Error(
        "SHOWCASE_INTEGRATIONS_DIR is not set; looked in /app/integrations",
      );
    });

    const html = await render("mastra");

    expect(html).toContain("Invalid Showcase route");
    expect(html).toContain("could not load the integration manifests");
    expect(html).toContain("SHOWCASE_INTEGRATIONS_DIR is not set");
    expect(html).toContain("mastra");
    expect(logged).toHaveBeenCalled();
  });
});

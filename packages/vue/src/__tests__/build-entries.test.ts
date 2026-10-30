// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { LibraryOptions } from "vite";
import config from "../../vite.config";
import { useFrontendTool as v1UseFrontendTool } from "../hooks/use-frontend-tool";
import { useFrontendTool as v2UseFrontendTool } from "../v2/hooks/use-frontend-tool";

// The package's "./v2" export points at the build's "v2/index" entry, and "."
// at "index". Each entry must build from the module that matches its export.
const entries = (config.build?.lib as LibraryOptions).entry as Record<
  string,
  string
>;

describe("library build entries", () => {
  it("builds @copilotkit/vue/v2 from the v2 module, with the v2 hooks", async () => {
    const v2 = await import(/* @vite-ignore */ entries["v2/index"]!);

    expect(v2.useFrontendTool).toBe(v2UseFrontendTool);
  });

  it("builds @copilotkit/vue from the root module, with the v1-compatible hooks", async () => {
    const root = await import(/* @vite-ignore */ entries.index!);

    expect(root.useFrontendTool).toBe(v1UseFrontendTool);
  });
});

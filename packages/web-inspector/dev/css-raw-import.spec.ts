// @vitest-environment node

import { describe, expect, it } from "vitest";

import viteConfig from "./vite.config.js";

describe("web-inspector dev vite config", () => {
  it("throws when the generated stylesheet import is missing from src/index.ts", () => {
    const plugin = Array.isArray(viteConfig.plugins)
      ? viteConfig.plugins.find(
          (candidate) =>
            candidate != null &&
            typeof candidate === "object" &&
            "name" in candidate &&
            candidate.name === "web-inspector-css-raw-import",
        )
      : undefined;

    if (!plugin || !("transform" in plugin) || !plugin.transform) {
      throw new Error("web-inspector-css-raw-import plugin not found");
    }

    expect(() =>
      plugin.transform.call(
        {} as never,
        'import tailwindStyles from "./styles/other.css";',
        "/repo/packages/web-inspector/src/index.ts",
      ),
    ).toThrow("generated.css import");
  });
});

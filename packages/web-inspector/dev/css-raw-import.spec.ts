// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import viteConfig from "./vite.config.js";

describe("web-inspector dev vite config", () => {
  it("throws when the generated stylesheet import is missing from the shell element", () => {
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
        'import tailwindStyles from "../styles/other.css";',
        "/repo/packages/web-inspector/src/shell/web-inspector-element.ts",
      ),
    ).toThrow("generated.css import");
  });

  it("keeps the generated stylesheet current in the standalone lab", () => {
    const project = JSON.parse(
      readFileSync(new URL("../project.json", import.meta.url), "utf8"),
    ) as {
      targets?: {
        "dev:standalone"?: {
          dependsOn?: Array<{ projects?: string; target?: string }>;
          options?: {
            commands?: Array<{ command?: string; forwardAllArgs?: boolean }>;
          };
        };
      };
    };
    const target = project.targets?.["dev:standalone"];

    expect(target?.dependsOn ?? []).toContainEqual({
      target: "build:css",
      projects: "self",
    });
    expect(target?.options?.commands ?? []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "pnpm run dev:css",
          forwardAllArgs: false,
        }),
        expect.objectContaining({
          command: expect.stringContaining("vite dev dev"),
          forwardAllArgs: true,
        }),
      ]),
    );
  });
});

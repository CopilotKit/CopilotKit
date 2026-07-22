import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import * as publicApi from "./index.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_HEADINGS = [
  "## Installation",
  "## Native registration",
  "## Lifecycle and preload",
  "## Fresh and cached data",
  "## Limits and scripts",
  "## Telemetry",
  "## Errors",
  "## Closing",
  "## Compatibility",
  "## Ownership and release",
] as const;

describe("README and public API contract", () => {
  it("exports and documents every required behavior", async () => {
    const readme = await readFile(join(packageRoot, "README.md"), "utf8");
    const packageJson = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    );
    const projectJson = JSON.parse(
      await readFile(join(packageRoot, "project.json"), "utf8"),
    );
    expect(readme.match(/^## .+$/gmu)).toEqual(REQUIRED_HEADINGS);
    expect(readme).toContain("createAgent({");
    expect(readme).toContain("middleware: [skills]");
    expect(readme).not.toContain("wrapAgent");
    expect(Object.keys(publicApi)).toEqual(["createSkillRegistryMiddleware"]);
    expect(packageJson).toMatchObject({
      name: "@copilotkit/intelligence-langgraph",
      version: "0.1.0",
      type: "module",
      engines: { node: ">=20" },
      peerDependencies: {
        "@copilotkit/intelligence": ">=0.1.0 <1.0.0",
        "@langchain/langgraph": ">=1.3.0 <2.0.0",
        langchain: ">=1.4.4 <2.0.0",
      },
    });
    expect(projectJson.targets.check.dependsOn).toEqual(["build"]);
  });
});

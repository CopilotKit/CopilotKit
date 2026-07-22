import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import * as publicApi from "./index.js";
import { ADAPTER_VERSION } from "./generated-version.js";
import {
  generateVersion,
  renderVersionModule,
} from "../scripts/generate-version.js";
import { extractNativeRegistrationSnippet } from "../scripts/verify-package-lib.js";

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
    const registrationSnippet = extractNativeRegistrationSnippet(readme);
    expect(registrationSnippet).toContain("createAgent({");
    expect(registrationSnippet).toContain("middleware: [skills]");
    expect(registrationSnippet).toContain("createSkillRegistryMiddleware");
    expect(readme).not.toContain("wrapAgent");
    expect(Object.keys(publicApi)).toEqual(["createSkillRegistryMiddleware"]);
    expect(packageJson).toMatchObject({
      name: "@copilotkit/intelligence-langgraph",
      type: "module",
      engines: { node: ">=20" },
      peerDependencies: {
        "@copilotkit/intelligence": ">=0.1.0 <1.0.0",
        "@langchain/langgraph": ">=1.3.0 <2.0.0",
        langchain: ">=1.4.4 <2.0.0",
      },
    });
    expect(packageJson.version).toMatch(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u,
    );
    expect(projectJson.targets.check.dependsOn).toEqual(["build"]);
  });

  it("derives the runtime adapter version from release-managed package metadata", async () => {
    const packageJson = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    );
    expect(ADAPTER_VERSION).toBe(packageJson.version);

    const temporary = await mkdtemp(join(tmpdir(), "langgraph-version-"));
    const manifestPath = join(temporary, "package.json");
    const outputPath = join(temporary, "generated-version.ts");
    try {
      await writeFile(
        manifestPath,
        JSON.stringify({ version: "7.8.9-beta.1" }),
      );
      await generateVersion({ manifestPath, outputPath });
      await expect(readFile(outputPath, "utf8")).resolves.toBe(
        renderVersionModule("7.8.9-beta.1"),
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});

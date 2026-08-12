import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface ManifestPackage {
  name: string;
  version: string;
  sourceDirectory: string;
  entrypoints: Array<{ importPath: string }>;
}

interface PublicApiManifest {
  packages: ManifestPackage[];
}

const manifest = JSON.parse(
  readFileSync(
    resolve(root, "scripts/release/public-api/manifest.v1.json"),
    "utf8",
  ),
) as PublicApiManifest;

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function libraryVersion(skill: string): string | undefined {
  return skill.match(/^library_version:\s*["']?([^"'\n]+)["']?$/m)?.[1];
}

function filesUnder(relativeDirectory: string): string[] {
  const absoluteDirectory = resolve(root, relativeDirectory);

  function walk(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    });
  }

  return walk(absoluteDirectory);
}

describe("public skill drift", () => {
  it.each([
    ["@copilotkit/runtime", "runtime"],
    ["@copilotkit/react-core", "react-core"],
    ["@copilotkit/a2ui-renderer", "a2ui-renderer"],
  ])(
    "%s skill version follows the public API manifest",
    (packageName, skillName) => {
      const packageEntry = manifest.packages.find(
        (candidate) => candidate.name === packageName,
      );
      expect(
        packageEntry,
        `${packageName} missing from manifest`,
      ).toBeDefined();

      const sourceSkill = read(
        `${packageEntry!.sourceDirectory}/skills/${skillName}/SKILL.md`,
      );
      const mirrorSkill = read(`skills/${skillName}/SKILL.md`);

      expect(libraryVersion(sourceSkill)).toBe(packageEntry!.version);
      expect(libraryVersion(mirrorSkill)).toBe(packageEntry!.version);
    },
  );

  it("keeps current setup and debugging paths free of retired API forms", () => {
    const currentFiles = [
      resolve(root, "skills/copilotkit-setup/eval.yaml"),
      ...filesUnder("skills/copilotkit-debug"),
    ];
    const retiredForms = [
      /@copilotkit\/react(?!-)/,
      /@copilotkit\/agent(?![a-z-])/,
      /\bcreateCopilotEndpoint(?:SingleRoute(?:Express)?|Express)?\b/,
      /packages\/v[12]\//,
    ];

    const findings = currentFiles.flatMap((file) => {
      const relativeFile = file.slice(root.length + 1);
      return readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          retiredForms.some((pattern) => pattern.test(line))
            ? [`${relativeFile}:${index + 1}: ${line.trim()}`]
            : [],
        );
    });

    expect(findings).toEqual([]);
  });

  it("grades the stylesheet through its exact public entrypoint", () => {
    const reactCore = manifest.packages.find(
      (candidate) => candidate.name === "@copilotkit/react-core",
    );
    const stylesheet = "@copilotkit/react-core/v2/styles.css";
    const setupEval = read("skills/copilotkit-setup/eval.yaml");

    expect(
      reactCore?.entrypoints.some(
        (entrypoint) => entrypoint.importPath === stylesheet,
      ),
    ).toBe(true);
    expect(setupEval).toContain(`grep -rF "${stylesheet}"`);
    expect(setupEval).not.toContain(
      'grep -r "styles\\.css\\|@copilotkit/react/styles"',
    );
  });

  it("keeps debugging source inventory paths resolvable", () => {
    const paths = read("skills/copilotkit-debug/sources.md")
      .split("\n")
      .flatMap(
        (line) => line.match(/^- (packages\/\S+?)(?:\/)? \(/)?.[1] ?? [],
      );

    expect(paths.length).toBeGreaterThan(0);
    expect(
      paths.filter((relativePath) => !existsSync(resolve(root, relativePath))),
    ).toEqual([]);
  });
});

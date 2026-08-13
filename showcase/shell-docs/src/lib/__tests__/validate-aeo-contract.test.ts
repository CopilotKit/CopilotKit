import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  loadAeoSurfaceContract,
  validateAeoSurfaceContract,
} from "../../../scripts/validate-aeo-contract";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../../../../..");

describe("public AEO surface contract", () => {
  it("is validated by shell-docs rather than shared showcase tooling", () => {
    expect(
      existsSync(
        resolve(testDirectory, "../../../scripts/validate-aeo-contract.ts"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        resolve(testDirectory, "../../../../scripts/validate-aeo-contract.ts"),
      ),
    ).toBe(false);
  });

  it("accepts the committed contract and every repository-owned check target", () => {
    const contract = loadAeoSurfaceContract(repositoryRoot);

    expect(validateAeoSurfaceContract(contract, repositoryRoot)).toEqual([]);
  });

  it("rejects a requirement that has neither an automated check nor a manual owner", () => {
    const contract = structuredClone(loadAeoSurfaceContract(repositoryRoot));
    const surface = contract.surfaces[0] as unknown as Record<string, unknown>;
    surface.enforcement = { mode: "manual-external" };

    expect(
      validateAeoSurfaceContract(contract, repositoryRoot).some((error) =>
        error.includes("manualOwner"),
      ),
    ).toBe(true);
  });

  it("rejects prose in place of a public endpoint path", () => {
    const contract = structuredClone(loadAeoSurfaceContract(repositoryRoot));
    const surface = contract.surfaces[0] as unknown as Record<string, unknown>;
    surface.endpoints = [
      { path: "all indexable HTML pages", contentTypes: ["text/html"] },
    ];
    delete surface.path;
    delete surface.contentTypes;

    expect(
      validateAeoSurfaceContract(contract, repositoryRoot).some(
        (error) =>
          error.includes("endpoints/0/path") && error.includes("pattern"),
      ),
    ).toBe(true);
  });

  it("wires every automated verification command into showcase CI", () => {
    const contract = loadAeoSurfaceContract(repositoryRoot);
    const workflow = readFileSync(
      resolve(repositoryRoot, ".github/workflows/showcase_validate.yml"),
      "utf8",
    );
    const commands = contract.surfaces.flatMap((surface) =>
      surface.enforcement.mode === "automated"
        ? [surface.enforcement.command]
        : [],
    );

    expect(commands.length).toBeGreaterThan(0);
    for (const command of new Set(commands)) {
      expect(workflow, `missing CI command: ${command}`).toContain(command);
    }
  });

  it("rejects automated checks that name a missing repository path", () => {
    const contract = structuredClone(loadAeoSurfaceContract(repositoryRoot));
    const automated = contract.surfaces.find(
      (surface) => surface.enforcement.mode === "automated",
    );
    if (!automated || automated.enforcement.mode !== "automated") {
      throw new Error("committed contract has no automated surface");
    }
    automated.enforcement.paths = ["missing/contract-owner.ts"];

    expect(validateAeoSurfaceContract(contract, repositoryRoot)).toContain(
      "automated check path does not exist: missing/contract-owner.ts",
    );
  });

  it("fails loudly when the contract JSON is malformed", () => {
    const root = mkdtempSync(resolve(tmpdir(), "aeo-contract-"));
    const contractPath = resolve(
      root,
      "showcase/shell-docs/aeo/public-surface-contract.v1.json",
    );
    mkdirSync(resolve(root, "showcase/shell-docs/aeo"), { recursive: true });
    writeFileSync(contractPath, "not-json");

    expect(() => loadAeoSurfaceContract(root)).toThrow(
      /Unable to parse .*public-surface-contract\.v1\.json/,
    );
  });
});

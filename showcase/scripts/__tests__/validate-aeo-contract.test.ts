import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadAeoSurfaceContract,
  validateAeoSurfaceContract,
} from "../validate-aeo-contract";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

describe("public AEO surface contract", () => {
  it("accepts the committed contract and every repository-owned check target", () => {
    const contract = loadAeoSurfaceContract(repositoryRoot);

    expect(validateAeoSurfaceContract(contract, repositoryRoot)).toEqual([]);
  });

  it("rejects a requirement that has neither an automated check nor a manual owner", () => {
    const contract = structuredClone(loadAeoSurfaceContract(repositoryRoot));
    contract.surfaces[0]!.enforcement = { mode: "manual-external" } as never;

    expect(validateAeoSurfaceContract(contract, repositoryRoot)).toContain(
      "surfaces[0].enforcement.manualOwner must be a non-empty string",
    );
  });

  it("rejects automated checks that name a missing repository path", () => {
    const contract = structuredClone(loadAeoSurfaceContract(repositoryRoot));
    const automated = contract.surfaces.find(
      (surface) => surface.enforcement.mode === "automated",
    );
    expect(automated).toBeDefined();
    automated!.enforcement.paths = ["missing/contract-owner.ts"];

    expect(validateAeoSurfaceContract(contract, repositoryRoot)).toContain(
      "automated check path does not exist: missing/contract-owner.ts",
    );
  });

  it("fails loudly when the contract JSON is malformed", () => {
    const root = mkdtempSync(join(tmpdir(), "aeo-contract-"));
    const contractPath = join(
      root,
      "showcase/shared/aeo/public-surface-contract.v1.json",
    );
    mkdirSync(join(root, "showcase/shared/aeo"), { recursive: true });
    writeFileSync(contractPath, "not-json");

    expect(() => loadAeoSurfaceContract(root)).toThrow(
      /Unable to parse .*public-surface-contract\.v1\.json/,
    );
  });
});

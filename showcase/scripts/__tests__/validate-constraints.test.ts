import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import yaml from "yaml";
import { validateManifestConstraints } from "../validate-constraints.js";

const CONSTRAINTS_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "shared",
  "constraints.yaml",
);
const FIXTURES_DIR = path.resolve(__dirname, "fixtures");

function loadConstraints() {
  return yaml.parse(fs.readFileSync(CONSTRAINTS_PATH, "utf-8"));
}

function loadFixture(name: string) {
  return yaml.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), "utf-8"));
}

describe("Constraint Validator", () => {
  const constraints = loadConstraints();

  it("passes a valid manifest", () => {
    const manifest = loadFixture("valid-manifest.yaml");
    const errors = validateManifestConstraints(manifest, constraints);
    expect(errors).toEqual([]);
  });

  it("rejects a demo not allowed by declared generative_ui", () => {
    const manifest = loadFixture("invalid-genui-manifest.yaml");
    const errors = validateManifestConstraints(manifest, constraints);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("tool-rendering");
    expect(errors[0]).toContain("not allowed");
  });

  it("skips validation when generative_ui is missing", () => {
    const manifest = loadFixture("missing-genui-manifest.yaml");
    const errors = validateManifestConstraints(manifest, constraints);
    expect(errors).toEqual([]);
  });

  it("rejects a demo ID not in any allowed list", () => {
    const manifest = loadFixture("unknown-demo-manifest.yaml");
    const errors = validateManifestConstraints(manifest, constraints);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("nonexistent-feature");
  });
});

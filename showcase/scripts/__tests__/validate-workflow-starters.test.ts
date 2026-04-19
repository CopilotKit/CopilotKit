/**
 * Tests for the workflow starter-list validator.
 *
 * Strategy mirrors validate-parity.test.ts: build ephemeral fixture trees
 * under per-suite tmpdirs, then invoke the validator with the
 * VALIDATE_WORKFLOW_STARTERS_REPO_ROOT env var pointed at the fixture root.
 * Committed fixtures aren't used because the whole point is to exercise
 * drift scenarios (missing slugs, missing workflows) that can't safely
 * live in the real repo tree.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import {
  listStarterSlugs,
  isSlugInWorkflowDispatch,
  isSlugInDeployMatrix,
} from "../validate-workflow-starters.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT = path.resolve(__dirname, "..", "validate-workflow-starters.ts");

// Exit codes must stay in lockstep with the validator.
const EXIT_OK = 0;
const EXIT_DRIFT = 1;
const EXIT_UNREADABLE = 3;

// Minimum legal workflow_dispatch + ALL_SERVICES skeleton. Keep the shape
// close to .github/workflows/showcase_deploy.yml so parser assumptions are
// exercised against production-shaped YAML. Slugs are templated in per test.
function buildDeployYaml(opts: {
  dispatchOptions: string[];
  matrixSlugs: string[];
}): string {
  const options = opts.dispatchOptions
    .map((s) => `          - ${s}`)
    .join("\n");
  const matrix = opts.matrixSlugs
    .map(
      (s) =>
        `            {"dispatch_name":"${s}","filter_key":"${s.replace(/-/g, "_")}","context":"showcase/starters/${s.replace(/^starter-/, "")}","image":"showcase-${s}","railway_id":"00000000-0000-0000-0000-000000000000","timeout":15,"lfs":false,"build_args":"","dockerfile":"","health_path":"/api/health"},`,
    )
    .join("\n");
  // The matrix is a heredoc-style embedded-JSON block inside a shell step.
  // Preserve the trailing `]` on its own line to match the real workflow.
  return `name: "Test Showcase Deploy"

on:
  workflow_dispatch:
    inputs:
      service:
        description: "Service to deploy"
        required: true
        type: choice
        options:
          - all
${options}
      reason:
        description: "Why"
        type: string

concurrency:
  group: test

jobs:
  detect-changes:
    runs-on: ubuntu-latest
    steps:
      - name: Build ALL_SERVICES
        run: |
          ALL_SERVICES='[
${matrix}
            {"dispatch_name":"sentinel","filter_key":"sentinel","context":".","image":"showcase-sentinel","railway_id":"x","timeout":1,"lfs":false,"build_args":"","dockerfile":"","health_path":"/"}
          ]'
`;
}

interface FixtureOpts {
  starterSlugs?: readonly string[]; // directory names under showcase/starters/
  extraDirs?: readonly string[]; // non-starter siblings (e.g. "template")
  dispatchOptions?: readonly string[]; // list of `starter-<slug>` entries in options
  matrixSlugs?: readonly string[]; // list of `starter-<slug>` entries in ALL_SERVICES
  omitDeployWorkflow?: boolean; // skip writing showcase_deploy.yml entirely
}

/**
 * Build a minimal repo-root fixture tree:
 *   <root>/showcase/starters/<slug>/
 *   <root>/.github/workflows/showcase_deploy.yml
 * Returns the root so the caller can pass it via
 * VALIDATE_WORKFLOW_STARTERS_REPO_ROOT.
 */
function makeFixtureRoot(opts: FixtureOpts): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vws-fixture-"));
  const startersDir = path.join(root, "showcase", "starters");
  fs.mkdirSync(startersDir, { recursive: true });
  for (const slug of opts.starterSlugs ?? []) {
    fs.mkdirSync(path.join(startersDir, slug), { recursive: true });
  }
  for (const extra of opts.extraDirs ?? []) {
    fs.mkdirSync(path.join(startersDir, extra), { recursive: true });
  }
  if (!opts.omitDeployWorkflow) {
    const workflowsDir = path.join(root, ".github", "workflows");
    fs.mkdirSync(workflowsDir, { recursive: true });
    const yaml = buildDeployYaml({
      dispatchOptions: [...(opts.dispatchOptions ?? [])],
      matrixSlugs: [...(opts.matrixSlugs ?? [])],
    });
    fs.writeFileSync(
      path.join(workflowsDir, "showcase_deploy.yml"),
      yaml,
      "utf-8",
    );
  }
  return root;
}

function runCli(root: string) {
  return spawnSync("npx", ["tsx", SCRIPT], {
    env: {
      ...process.env,
      VALIDATE_WORKFLOW_STARTERS_REPO_ROOT: root,
    },
    encoding: "utf-8",
    timeout: 30_000,
  });
}

describe("validate-workflow-starters", () => {
  let roots: string[];

  beforeEach(() => {
    roots = [];
  });

  afterEach(() => {
    for (const r of roots) {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });

  function fixture(opts: FixtureOpts): string {
    const r = makeFixtureRoot(opts);
    roots.push(r);
    return r;
  }

  describe("listStarterSlugs (pure helper)", () => {
    it("excludes the template/ scaffolding directory", () => {
      const root = fixture({
        starterSlugs: ["ag2", "mastra"],
        extraDirs: ["template"],
      });
      const slugs = listStarterSlugs(path.join(root, "showcase", "starters"));
      expect(slugs).toEqual(["ag2", "mastra"]);
      expect(slugs).not.toContain("template");
    });

    it("returns slugs sorted lexicographically for stable diff output", () => {
      const root = fixture({
        starterSlugs: ["zoo", "ag2", "mastra"],
      });
      const slugs = listStarterSlugs(path.join(root, "showcase", "starters"));
      expect(slugs).toEqual(["ag2", "mastra", "zoo"]);
    });
  });

  describe("isSlugInWorkflowDispatch (pure helper)", () => {
    it("uses word-boundary matching so prefixes can't spoof presence", () => {
      // `starter-ag2` must NOT match `starter-ag2-extended` — word-boundary
      // anchoring is load-bearing: a regression here would let typos pass
      // silently while the real starter stayed unregistered.
      const yaml = buildDeployYaml({
        dispatchOptions: ["starter-ag2-extended"],
        matrixSlugs: ["starter-ag2-extended"],
      });
      expect(isSlugInWorkflowDispatch(yaml, "starter-ag2")).toBe(false);
      expect(isSlugInWorkflowDispatch(yaml, "starter-ag2-extended")).toBe(true);
    });
  });

  describe("isSlugInDeployMatrix (pure helper)", () => {
    it("matches only the full dispatch_name, not substrings", () => {
      const yaml = buildDeployYaml({
        dispatchOptions: [],
        matrixSlugs: ["starter-ag2-extended"],
      });
      expect(isSlugInDeployMatrix(yaml, "starter-ag2")).toBe(false);
      expect(isSlugInDeployMatrix(yaml, "starter-ag2-extended")).toBe(true);
    });
  });

  describe("CLI subprocess", () => {
    it("exits 0 when every starter is present in both workflow locations", () => {
      const root = fixture({
        starterSlugs: ["ag2", "mastra"],
        dispatchOptions: ["starter-ag2", "starter-mastra"],
        matrixSlugs: ["starter-ag2", "starter-mastra"],
      });
      const r = runCli(root);
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(EXIT_OK);
      expect(r.stdout).toMatch(/OK: all 2 starter\(s\) registered/);
    });

    it("exits 1 when a slug is only missing from workflow_dispatch options", () => {
      const root = fixture({
        starterSlugs: ["ag2", "mastra"],
        dispatchOptions: ["starter-ag2"], // mastra missing here
        matrixSlugs: ["starter-ag2", "starter-mastra"],
      });
      const r = runCli(root);
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(EXIT_DRIFT);
      expect(r.stderr).toMatch(/starter-mastra/);
      expect(r.stderr).toMatch(
        /missing from:\s+showcase_deploy\.yml workflow_dispatch/,
      );
      // Matrix source should NOT appear for mastra since it's present there
      expect(r.stderr).not.toMatch(
        /starter-mastra[\s\S]*ALL_SERVICES matrix/m,
      );
    });

    it("exits 1 when a slug is only missing from the ALL_SERVICES matrix", () => {
      const root = fixture({
        starterSlugs: ["ag2", "mastra"],
        dispatchOptions: ["starter-ag2", "starter-mastra"],
        matrixSlugs: ["starter-ag2"], // mastra missing here
      });
      const r = runCli(root);
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(EXIT_DRIFT);
      expect(r.stderr).toMatch(/starter-mastra/);
      expect(r.stderr).toMatch(
        /missing from:\s+showcase_deploy\.yml ALL_SERVICES matrix/,
      );
    });

    it("exits 1 and names both sources when a slug is missing from both", () => {
      const root = fixture({
        starterSlugs: ["ag2", "mastra"],
        dispatchOptions: ["starter-ag2"],
        matrixSlugs: ["starter-ag2"],
      });
      const r = runCli(root);
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(EXIT_DRIFT);
      // Both sources should be listed for mastra
      expect(r.stderr).toMatch(
        /starter-mastra[\s\S]*workflow_dispatch[\s\S]*ALL_SERVICES matrix/m,
      );
    });

    it("exits 3 when showcase/starters/ is empty (refuses trivial pass)", () => {
      const root = fixture({
        starterSlugs: [],
        dispatchOptions: [],
        matrixSlugs: [],
      });
      const r = runCli(root);
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(
        EXIT_UNREADABLE,
      );
      expect(r.stderr).toMatch(/No starter directories found/);
      expect(r.stderr).toMatch(/Refusing to pass trivially/);
    });

    it("ignores template/ scaffolding (doesn't flag it as missing)", () => {
      const root = fixture({
        starterSlugs: ["ag2"],
        extraDirs: ["template"],
        // Note: "starter-template" is NOT in either workflow location.
        // A naive enumerator would flag it as drift; the validator must not.
        dispatchOptions: ["starter-ag2"],
        matrixSlugs: ["starter-ag2"],
      });
      const r = runCli(root);
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(EXIT_OK);
      expect(r.stdout).not.toMatch(/starter-template/);
      expect(r.stderr).not.toMatch(/starter-template/);
    });

    it("rejects substring-spoof: starter-ag2 missing while starter-ag2-extended is present", () => {
      // Critical regression guard: if a typo gets registered as a different
      // slug (starter-ag2-extended) the validator must NOT silently accept
      // starter-ag2 as covered just because its characters appear inside
      // the longer slug. Word-boundary anchoring keeps this honest.
      const root = fixture({
        starterSlugs: ["ag2"],
        dispatchOptions: ["starter-ag2-extended"],
        matrixSlugs: ["starter-ag2-extended"],
      });
      const r = runCli(root);
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(EXIT_DRIFT);
      expect(r.stderr).toMatch(/starter-ag2\b/);
    });

    it("exits 3 when showcase_deploy.yml is missing entirely", () => {
      const root = fixture({
        starterSlugs: ["ag2"],
        omitDeployWorkflow: true,
      });
      const r = runCli(root);
      expect(r.status, (r.stdout ?? "") + (r.stderr ?? "")).toBe(
        EXIT_UNREADABLE,
      );
      expect(r.stderr).toMatch(/Cannot read/);
      expect(r.stderr).toMatch(/showcase_deploy\.yml/);
    });
  });
});

#!/usr/bin/env node
// Fails when a test file in git has no CI job that runs it (PE-1113).
//
// A test that CI never runs looks like coverage but guards nothing, and
// mutation testing only scores tests that run. This check maps every tracked
// test file to the CI job that runs it, using the rules in
// `scripts/test-ci-coverage-map.mjs`, and fails on:
//
//   - a test file that no rule and no allowlist entry matches;
//   - a rule whose workflow file is missing, or no longer contains the
//     command the rule names (the job was removed or renamed);
//   - a rule or allowlist entry that matches no test file (it is stale).
//
// Usage:
//   node scripts/validate-test-ci-coverage.mjs           # check
//   node scripts/validate-test-ci-coverage.mjs --report  # also print the map
//
// Pure Node, no dependencies: reads `git ls-files` and the workflow files.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWLIST,
  NOT_TEST_GLOBS,
  RULES,
  TEST_FILE_GLOBS,
} from "./test-ci-coverage-map.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const WORKFLOW_DIR = ".github/workflows";

function escapeRegExp(text) {
  return text.replace(/[.+^$()|[\]\\]/g, "\\$&");
}

/**
 * Converts a glob to an anchored regular expression. Supports `**` (any
 * number of directories), `*` and `?` (inside one path segment) and
 * `{a,b}` alternatives. Paths use forward slashes, as `git ls-files` prints.
 */
export function globToRegExp(glob) {
  return new RegExp(`^${globToSource(glob)}$`);
}

function globToSource(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        source += "(?:[^/]+/)*";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) throw new Error(`Unclosed "{" in glob: ${glob}`);
      const options = glob
        .slice(i + 1, end)
        .split(",")
        .map(globToSource);
      source += `(?:${options.join("|")})`;
      i = end;
    } else {
      source += escapeRegExp(char);
    }
  }
  return source;
}

/** Returns a predicate that is true when a path matches any of the globs. */
export function matcher(globs) {
  const patterns = [globs].flat().map(globToRegExp);
  return (path) => patterns.some((pattern) => pattern.test(path));
}

/** Keeps the tracked paths that are test files. */
export function selectTestFiles(paths, testGlobs, notTestGlobs) {
  const isTest = matcher(testGlobs);
  const isNotTest = matcher(notTestGlobs);
  return paths.filter((path) => isTest(path) && !isNotTest(path));
}

/**
 * Maps test files to rules and validates the rules.
 *
 * @param {object} input
 * @param {string[]} input.testFiles  repo-relative test file paths
 * @param {Array<{workflow: string, runs: string|string[], files: string|string[], exclude?: string|string[]}>} input.rules
 * @param {Array<{files: string|string[], reason: string}>} input.allowlist
 * @param {(workflow: string) => string|undefined} input.readWorkflow
 *   returns the workflow file text, or undefined when the file is missing
 */
export function checkCoverage({ testFiles, rules, allowlist, readWorkflow }) {
  const compiledRules = rules.map((rule) => {
    const includes = matcher(rule.files);
    const excludes = matcher(rule.exclude ?? []);
    return { rule, matches: (path) => includes(path) && !excludes(path) };
  });
  const compiledAllow = allowlist.map((entry) => ({
    entry,
    matches: matcher(entry.files),
  }));

  const ruleHits = new Map(rules.map((rule) => [rule, []]));
  const allowHits = new Map(allowlist.map((entry) => [entry, []]));
  const unmapped = [];

  for (const file of testFiles) {
    let mapped = false;
    for (const { rule, matches } of compiledRules) {
      if (matches(file)) {
        ruleHits.get(rule).push(file);
        mapped = true;
      }
    }
    for (const { entry, matches } of compiledAllow) {
      if (matches(file)) {
        allowHits.get(entry).push(file);
        mapped = true;
      }
    }
    if (!mapped) unmapped.push(file);
  }

  const brokenRules = [];
  for (const rule of rules) {
    const text = readWorkflow(rule.workflow);
    if (text === undefined) {
      brokenRules.push({
        rule,
        problem: `workflow ${rule.workflow} not found`,
      });
      continue;
    }
    for (const command of [rule.runs].flat()) {
      if (!text.includes(command)) {
        brokenRules.push({
          rule,
          problem: `${rule.workflow} no longer contains ${JSON.stringify(command)}`,
        });
      }
    }
  }

  const staleRules = rules.filter((rule) => ruleHits.get(rule).length === 0);
  const staleAllow = allowlist.filter(
    (entry) => allowHits.get(entry).length === 0,
  );

  return { unmapped, brokenRules, staleRules, staleAllow, ruleHits, allowHits };
}

function describe(globs) {
  return [globs].flat().join(", ");
}

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return output.split("\0").filter(Boolean);
}

function readWorkflowFromDisk(workflow) {
  const path = join(REPO_ROOT, WORKFLOW_DIR, workflow);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

function main() {
  const report = process.argv.includes("--report");
  const testFiles = selectTestFiles(
    listTrackedFiles(),
    TEST_FILE_GLOBS,
    NOT_TEST_GLOBS,
  );
  const result = checkCoverage({
    testFiles,
    rules: RULES,
    allowlist: ALLOWLIST,
    readWorkflow: readWorkflowFromDisk,
  });

  if (report) {
    console.log("Test files per CI job:\n");
    for (const rule of RULES) {
      const count = result.ruleHits.get(rule).length;
      console.log(
        `${String(count).padStart(5)}  ${rule.workflow} :: ${[rule.runs].flat()[0]}\n       ${describe(rule.files)}`,
      );
    }
    console.log("\nAllowlisted (no CI job, on purpose):\n");
    for (const entry of ALLOWLIST) {
      const count = result.allowHits.get(entry).length;
      console.log(
        `${String(count).padStart(5)}  ${describe(entry.files)}\n       ${entry.reason}`,
      );
    }
    console.log("");
  }

  const failures = [];
  if (result.unmapped.length > 0) {
    failures.push(
      `${result.unmapped.length} test file(s) have no CI job that runs them:\n` +
        result.unmapped.map((file) => `  ${file}`).join("\n") +
        "\n\nAdd the file to a CI job and a rule in scripts/test-ci-coverage-map.mjs, " +
        "or add an ALLOWLIST entry there that says why CI does not run it.",
    );
  }
  for (const { rule, problem } of result.brokenRules) {
    failures.push(`Rule for ${describe(rule.files)}: ${problem}.`);
  }
  for (const rule of result.staleRules) {
    failures.push(
      `Rule for ${describe(rule.files)} (${rule.workflow}) matches no test file. Remove or fix it.`,
    );
  }
  for (const entry of result.staleAllow) {
    failures.push(
      `Allowlist entry ${describe(entry.files)} matches no test file. Remove it.`,
    );
  }

  if (failures.length > 0) {
    console.error(failures.join("\n\n"));
    process.exit(1);
  }
  console.log(
    `OK: ${testFiles.length} test files map to a CI job (${RULES.length} rules, ${ALLOWLIST.length} allowlist entries).`,
  );
}

if (
  process.argv[1] &&
  relative(process.argv[1], fileURLToPath(import.meta.url)) === ""
) {
  main();
}

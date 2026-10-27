import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const selectionJobs = new Set(["detect-changes", "detect-starter-changes"]);
const classifierStepLines = [
  "      - name: Classify build and deploy workflow changes",
  "        id: workflow-impact",
  "        env:",
  "          BEFORE_SHA: ${{ github.event.before }}",
  "        run: node scripts/showcase-build-impact.mjs",
];

// Ignore only path filters and the classifier plumbing added by this change.
// Keep the rest of each selector, including matrix build arguments, contexts,
// Dockerfiles, output logic and environment: those ARE image build inputs.
function normalizeSelection(lines) {
  const result = [];
  let filterBody = false;
  let classifierStep = null;
  const finishClassifierStep = () => {
    if (classifierStep === null) return;
    if (
      JSON.stringify(classifierStep) !== JSON.stringify(classifierStepLines)
    ) {
      throw new Error("Unsupported classifier step content");
    }
    classifierStep = null;
  };
  for (let line of lines) {
    if (classifierStep !== null) {
      if (!line.startsWith("      - ")) {
        if (line.trim()) classifierStep.push(line);
        continue;
      }
      finishClassifierStep();
    }
    if (line === classifierStepLines[0]) {
      classifierStep = [line];
      continue;
    }
    if (/^          filters: \|\s*$/.test(line)) {
      filterBody = true;
      result.push("          filters: <path-selection>");
      continue;
    }
    if (filterBody) {
      if (/^\s*$/.test(line) || /^ {11}/.test(line)) continue;
      filterBody = false;
    }
    if (
      line ===
      "          WORKFLOW_RUNTIME_CHANGED: ${{ steps.workflow-impact.outputs.changed }}"
    )
      continue;
    line = line
      .replace(
        ' --argjson workflow_changed "${WORKFLOW_RUNTIME_CHANGED:-false}"',
        "",
      )
      .replaceAll(
        '($workflow_changed or ($changes | index("workflow_config") != null))',
        '($changes | index("workflow_config") != null)',
      );
    if (line.trim() && !line.trimStart().startsWith("#")) result.push(line);
  }
  finishClassifierStep();
  return result;
}

// No YAML dependency is needed on the runner. Unfamiliar layouts refuse rather
// than silently classifying a runtime edit as path-filter maintenance.
export function runtimeWorkflow(source) {
  const lines = source.split("\n");
  if (lines.filter((line) => line === "jobs:").length !== 1) {
    throw new Error("Expected one top-level jobs mapping");
  }
  const seen = new Set();
  let inJobs = false;
  let omit = false;
  const result = [];
  let selection = [];
  const flush = () => {
    result.push(...normalizeSelection(selection));
    selection = [];
  };
  for (const line of lines) {
    if (line === "jobs:") inJobs = true;
    if (inJobs) {
      const job = /^  ([\w-]+):\s*$/.exec(line);
      if (job) {
        flush();
        if (seen.has(job[1])) throw new Error(`Duplicate job: ${job[1]}`);
        seen.add(job[1]);
        omit = selectionJobs.has(job[1]);
      } else if (/^  [^\s#]/.test(line)) {
        throw new Error("Unsupported job header layout");
      } else if (/^\S/.test(line) && line !== "jobs:") {
        // Refuse an unfamiliar layout rather than silently hiding runtime jobs.
        throw new Error("Expected jobs to be the final top-level mapping");
      }
    }
    if (omit) selection.push(line);
    else result.push(line);
  }
  flush();
  if (![...selectionJobs].every((job) => seen.has(job)) || seen.size <= 2) {
    throw new Error("Missing selection or runtime jobs");
  }
  return result.join("\n");
}

export function workflowRuntimeChanged(before, after) {
  return runtimeWorkflow(before) !== runtimeWorkflow(after);
}

function main() {
  let changed = false;
  if (process.env.GITHUB_EVENT_NAME === "push") {
    const before = process.env.BEFORE_SHA;
    const after = process.env.GITHUB_SHA;
    if (
      ![before, after].every(
        (sha) => /^[a-f0-9]{40}$/.test(sha ?? "") && !/^0+$/.test(sha),
      )
    ) {
      throw new Error(
        "Push comparison requires nonzero before/after commit SHAs",
      );
    }
    const path = ".github/workflows/showcase_build.yml";
    const git = (args) =>
      execFileSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    // Checkout is shallow. The push's before SHA can span several merged PRs.
    try {
      git(["cat-file", "-e", `${before}:${path}`]);
    } catch {
      git(["fetch", "--no-tags", "--depth=1", "origin", before]);
    }
    changed = workflowRuntimeChanged(
      git(["show", `${before}:${path}`]),
      git(["show", `${after}:${path}`]),
    );
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
  console.log(`Build/deploy workflow changed: ${changed}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();

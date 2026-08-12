import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateScenario,
  formatDiagnostic,
  loadManifest,
  summarizeResults,
} from "./evaluator";
import type { SkillEvaluationScenario } from "./evaluator";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function source(path: string) {
  return {
    path,
    source: readFileSync(resolve(root, path), "utf8"),
  };
}

const scenarios: SkillEvaluationScenario[] = [
  {
    id: "current-setup-assets",
    skill: "copilotkit-setup",
    sources: [
      source("skills/copilotkit-setup/assets/nextjs-app-router-route.ts"),
      source("skills/copilotkit-setup/assets/nextjs-app-router-page.tsx"),
      source("skills/copilotkit-setup/assets/express-runtime.ts"),
    ],
    requiredEntrypoints: ["@copilotkit/react-core/v2/styles.css"],
  },
];

const manifest = loadManifest(root);
const results = scenarios.map((scenario) =>
  evaluateScenario(root, manifest, scenario),
);

if (results.length === 0) {
  throw new Error("No public skill evaluation scenarios were configured");
}

for (const result of results) {
  console.log(
    `${result.passed ? "PASS" : "FAIL"} ${result.skill}/${result.id} (${result.durationMs}ms)`,
  );
  for (const diagnostic of result.diagnostics) {
    console.error(`  ${formatDiagnostic(diagnostic)}`);
  }
}

const summary = summarizeResults(results);
console.log(
  `Summary: ${summary.passed}/${summary.total} passed (${(
    summary.passRate * 100
  ).toFixed(
    1,
  )}%); median attempts ${summary.medianAttempts ?? "n/a"}; median time-to-green ${
    summary.medianTimeToGreenMs ?? "n/a"
  }ms`,
);

if (summary.passed !== summary.total) {
  process.exitCode = 1;
}

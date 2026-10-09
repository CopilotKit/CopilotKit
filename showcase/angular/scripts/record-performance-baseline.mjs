import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { measureInitialGraph } from "./check-performance-budget.mjs";

const projectDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const initial = measureInitialGraph(projectDirectory);
const baseline = {
  schemaVersion: 1,
  sourceRevision: "checkpoint-3-shared-build",
  command: "pnpm --dir showcase/angular build",
  initial,
  maximumRelativeRegression: 0.1,
  absoluteCapBytes: 4_600_000,
  runtimeReadiness: {
    route: "/angular/agentic-chat",
    samplesPerIntegration: 10,
    maximumReadyMs: 2_000,
    integrations: {},
  },
};

writeFileSync(
  join(projectDirectory, "performance-baseline.json"),
  `${JSON.stringify(baseline, null, 2)}\n`,
);

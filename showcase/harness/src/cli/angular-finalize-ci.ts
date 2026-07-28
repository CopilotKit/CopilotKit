#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

import { Command } from "commander";

import {
  angularSupportedFeatureIdsFromRegistry,
  buildAngularFinalReport,
} from "../probes/angular-final-report.js";
import type { AngularCanaryEvidence } from "../probes/angular-final-report.js";
import type {
  AcceptedBaselineFailure,
  FrontendParityReport,
} from "../probes/frontend-parity-gate.js";

interface BaselinePolicy {
  schemaVersion: 1;
  acceptedFailures: AcceptedBaselineFailure[];
}

/** Read one trusted CI evidence file as JSON. */
async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

/** Find browser-canary evidence files below an artifact directory. */
async function findCanaryFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findCanaryFiles(candidate)));
    } else if (entry.isFile() && entry.name.endsWith("-canaries.json")) {
      found.push(candidate);
    }
  }
  return found.sort();
}

/** Validate all final gate evidence and write the bounded merge report. */
async function main(options: {
  parity: string;
  policy: string;
  registry: string;
  canaries: string;
  output: string;
}): Promise<void> {
  const [parity, policy, registry, canaryFiles] = await Promise.all([
    readJson<FrontendParityReport>(options.parity),
    readJson<BaselinePolicy>(options.policy),
    readJson<unknown>(options.registry),
    findCanaryFiles(options.canaries),
  ]);
  if (policy.schemaVersion !== 1) {
    throw new Error(
      `unsupported baseline policy schema ${policy.schemaVersion}`,
    );
  }
  const canaries = await Promise.all(
    canaryFiles.map((file) => readJson<AngularCanaryEvidence>(file)),
  );
  const report = buildAngularFinalReport({
    parity,
    canaries,
    acceptedBaselineFailures: policy.acceptedFailures,
    supportedAngularFeatureIds:
      angularSupportedFeatureIdsFromRegistry(registry),
  });
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Final Angular proof covers ${report.pairedCells} pairs and ${report.supportedAngularFeatures} features.`,
  );
}

await new Command()
  .name("angular-finalize-ci")
  .requiredOption("--parity <file>")
  .requiredOption("--policy <file>")
  .requiredOption("--registry <file>")
  .requiredOption("--canaries <directory>")
  .requiredOption("--output <file>")
  .action(main)
  .parseAsync();

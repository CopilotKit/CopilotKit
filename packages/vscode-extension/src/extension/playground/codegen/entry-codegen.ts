import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PlaygroundScanResult } from "../types";
import { ERROR_BOUNDARY_SOURCE } from "./error-boundary-source";
import { renderAggregator } from "./aggregator-template";
import { renderEntry } from "./provider-chain-template";

export interface PlaygroundSources {
  outDir: string;
  entryPath: string;
}

/**
 * Emits the three generated files into a unique temp directory and returns
 * the entry path the bundler will consume. Returns null when there's no
 * <CopilotKit> provider in the scan — nothing to bundle.
 *
 * The caller owns directory lifecycle (cleanup, replacement on re-scan).
 */
export function writePlaygroundSources(
  scan: PlaygroundScanResult,
): PlaygroundSources | null {
  const provider = scan.providers[0];
  if (!provider) return null;

  const outDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "copilotkit-playground-"),
  );

  fs.writeFileSync(
    path.join(outDir, "error-boundary.tsx"),
    ERROR_BOUNDARY_SOURCE,
    "utf-8",
  );

  const aggregatorSrc = renderAggregator(scan.componentsWithHooks, {
    outDir,
    errorBoundaryModule: "./error-boundary",
  });
  fs.writeFileSync(path.join(outDir, "aggregator.tsx"), aggregatorSrc, "utf-8");

  const entrySrc = renderEntry({
    provider,
    ancestors: scan.ancestorChain ?? [],
    aggregatorModule: "./aggregator",
    outDir,
  });
  const entryPath = path.join(outDir, "entry.tsx");
  fs.writeFileSync(entryPath, entrySrc, "utf-8");

  return { outDir, entryPath };
}

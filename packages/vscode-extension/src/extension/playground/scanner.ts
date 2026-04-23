import type { PlaygroundScanResult } from "./types";

/**
 * Top-level workspace scan. Orchestrated in later tasks — for now returns
 * an empty, well-shaped result so downstream code can type-check against it.
 */
export function scanPlayground(_workspaceRoot: string): PlaygroundScanResult {
  return {
    providers: [],
    componentsWithHooks: [],
    hookSites: [],
    warnings: [],
  };
}

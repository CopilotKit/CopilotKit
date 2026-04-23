import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export type ReleaseScope = "monorepo" | "cli" | "angular";

export interface ScopeConfig {
  packages: string[];
  versionSource: string;
  sharedVersion: boolean;
}

export interface ReleaseConfig {
  prereleaseTag: string;
  scopes: Record<ReleaseScope, ScopeConfig>;
}

export function loadConfig(): ReleaseConfig {
  const configPath = path.join(ROOT, "release.config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

export function getScopeConfig(scope: ReleaseScope): ScopeConfig {
  const config = loadConfig();
  const scopeConfig = config.scopes[scope];
  if (!scopeConfig) {
    throw new Error(
      `Unknown scope: ${scope}. Valid scopes: ${Object.keys(config.scopes).join(", ")}`,
    );
  }
  return scopeConfig;
}

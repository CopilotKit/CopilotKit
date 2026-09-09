import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export type ReleaseScope = "monorepo" | "angular" | "channels";

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

/**
 * Sentinel `scope` value selecting EVERY scope in release.config.json.
 *
 * Canary-only (the stable lane derives its tag and release branch from a single
 * scope name). It exists because scopes are only independent on the version
 * axis, not the dependency axis: `@copilotkit/runtime` carries
 * `"@copilotkit/channels-intelligence": "workspace:^"`, and `pnpm pack`
 * rewrites that against whatever is in the working tree. A canary of one scope
 * therefore ships a range built from the OTHER scope's last stable release,
 * which cannot resolve to the same-run canary. Publishing every scope from one
 * commit rewrites those ranges against the same-run canary versions instead.
 */
export const ALL_SCOPES = "all";

/**
 * Resolve a dispatched `scope` input into the concrete scopes to act on:
 * {@link ALL_SCOPES} expands to every scope in release.config.json order, any
 * other value must name exactly one scope.
 */
export function resolveScopes(selector: string): ReleaseScope[] {
  const scopes = Object.keys(loadConfig().scopes) as ReleaseScope[];
  if (selector === ALL_SCOPES) return scopes;
  if (!scopes.includes(selector as ReleaseScope)) {
    throw new Error(
      `Unknown scope: ${selector}. Valid scopes: ${[...scopes, ALL_SCOPES].join(", ")}`,
    );
  }
  return [selector as ReleaseScope];
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

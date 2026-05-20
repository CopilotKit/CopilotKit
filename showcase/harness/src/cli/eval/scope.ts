/**
 * Scope detection for the eval system.
 *
 * Given a list of changed file paths (relative to repo root) and the
 * canonical set of integration slugs, determines whether to run all
 * integrations, a subset, or nothing.
 *
 * Pure function — no I/O.
 */

export interface ScopeResult {
  mode: "all" | "per-integration" | "unrelated";
  reason: string;
  slugs: string[];
}

/**
 * Patterns that affect the entire showcase platform. A match on any of
 * these means every integration must be re-evaluated.
 */
const PLATFORM_WIDE_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  {
    regex: /^packages\/(runtime|sdk-js|react-core|react-ui|react-textarea)\//,
    label: "packages/{matched}",
  },
  { regex: /^showcase\/(shared|aimock)\//, label: "showcase/{matched}" },
  {
    regex: /^showcase\/docker-compose\.local\.yml$/,
    label: "showcase/docker-compose.local.yml",
  },
  { regex: /^showcase\/tests\//, label: "showcase/tests" },
  { regex: /^showcase\/scripts\/cli\//, label: "showcase/scripts/cli" },
  { regex: /^pnpm-lock\.yaml$/, label: "pnpm-lock.yaml" },
];

/**
 * Regex to extract an integration slug from a changed file path.
 * Matches `showcase/integrations/<slug>/...`.
 */
const INTEGRATION_RE = /^showcase\/integrations\/([^/]+)\//;

/**
 * Classify the scope of a set of changed files.
 *
 * @param changedFiles - Repo-relative file paths (e.g. from `git diff --name-only`).
 * @param allSlugs    - The canonical list of all integration slugs.
 * @returns A ScopeResult describing what to evaluate.
 */
export function classifyScope(
  changedFiles: string[],
  allSlugs: string[],
): ScopeResult {
  if (changedFiles.length === 0) {
    return { mode: "unrelated", reason: "no changed files", slugs: [] };
  }

  // Check platform-wide patterns first (takes precedence).
  for (const file of changedFiles) {
    for (const { regex, label } of PLATFORM_WIDE_PATTERNS) {
      const match = file.match(regex);
      if (match) {
        // Build a human-readable reason with the matched segment.
        const reason = label.includes("{matched}")
          ? label.replace("{matched}", match[1])
          : label;
        return {
          mode: "all",
          reason: `platform-wide change: ${reason}`,
          slugs: [...allSlugs],
        };
      }
    }
  }

  // Collect per-integration slugs.
  const slugSet = new Set<string>();
  for (const file of changedFiles) {
    const match = file.match(INTEGRATION_RE);
    if (match) {
      const slug = match[1];
      // Only include slugs that are in the canonical list.
      if (allSlugs.includes(slug)) {
        slugSet.add(slug);
      }
    }
  }

  if (slugSet.size > 0) {
    const slugs = [...slugSet].sort();
    return {
      mode: "per-integration",
      reason: `integration changes: ${slugs.join(", ")}`,
      slugs,
    };
  }

  return {
    mode: "unrelated",
    reason: "no showcase-relevant changes",
    slugs: [],
  };
}

import { execFileSync } from "node:child_process";
import * as path from "node:path";

/**
 * Guards the canonical Intelligence config surface: the project API key's name,
 * and the hostnames that actually serve the managed platform.
 *
 * `INTELLIGENCE_API_KEY` is what `copilotkit project select` provisions into
 * `.env`. Two other names were live in CopilotKit's own documentation and each
 * produced an undefined key for a reader who followed it with a CLI-provisioned
 * project (OSS-881):
 *
 * - `COPILOTKIT_INTELLIGENCE_API_KEY` — Channels READMEs and packaged skills.
 *   Retired outright: nothing ever read it.
 * - `COPILOTKIT_API_KEY` — the Slack/Teams examples and the client's own TSDoc.
 *   Still read as a deprecated alias by those two examples, so it is allowed
 *   only at the small set of sites that implement or document that fallback.
 *
 * It also guards the two hostnames that shipped material must never name. Both
 * were prescribed by the packaged runtime skill up to v1.62.2 and produced a
 * dead-end for anyone who followed it (OSS-621, then again OSS-961):
 *
 * - `api.copilotkit.ai` — a CNAME onto the legacy Copilot Cloud load balancer.
 *   No listener rule matches that host, so every request gets the ALB's default
 *   action: a 404 with an empty body, which reads like an application error.
 * - `realtime.copilotkit.ai` — no DNS record at all. A wrong `wsUrl` does not
 *   fail fast; the socket layer treats an unreachable host as a retryable
 *   reconnect, so it hangs in `connecting` with no stated cause.
 *
 * The managed pair is `api.intelligence.copilotkit.ai` /
 * `realtime.intelligence.copilotkit.ai`.
 *
 * This is a documentation-drift guard, not a runtime check. It fails on a
 * retired name reappearing anywhere, on the alias appearing outside its
 * allowlist, and on a dead host appearing outside its allowlist.
 */

const REPO_ROOT = path.resolve(__dirname, "..");

/** Never valid anywhere. Nothing has ever read this name. */
const RETIRED = [
  "COPILOTKIT_INTELLIGENCE_API_KEY",
  "COPILOTKIT_INTELLIGENCE_ORG_ID",
];

/**
 * Deprecated but still read as a fallback. Permitted only where the fallback is
 * implemented or explicitly described as deprecated.
 */
const ALIAS = "COPILOTKIT_API_KEY";

/**
 * Paths allowed to mention {@link ALIAS}.
 *
 * `NEXT_PUBLIC_COPILOTKIT_API_KEY` is a different value entirely — the legacy
 * Copilot Cloud public key — so files carrying only that prefixed form are
 * matched and skipped by prefix rather than listed here.
 */
const ALIAS_ALLOWLIST = [
  "examples/slack/.env.example",
  "examples/slack/README.md",
  "examples/slack/app/index.ts",
  "examples/slack/app/managed.ts",
  "examples/slack/app/managed.test.ts",
  "examples/teams/.env.example",
  "examples/teams/README.md",
  "examples/teams/app/index.tsx",
  "scripts/validate-intelligence-env-names.ts",
  "skills/copilotkit-setup/SKILL.md",
  // The importer genuinely accepts both names; these lines document that.
  "showcase/shell-docs/src/content/docs/integrations/adk/threads-import.mdx",
  "showcase/shell-docs/src/content/docs/integrations/langgraph/threads-import.mdx",
  "showcase/shell-docs/src/content/snippets/shared/cli/cli.mdx",
  "showcase/shell-docs/src/content/snippets/shared/threads/threads-import.mdx",
];

/**
 * Hostnames that serve no Intelligence traffic. Neither should appear in any
 * shipped page, README, example, or packaged skill.
 */
const DEAD_HOSTS = [
  {
    host: "api.copilotkit.ai",
    reason:
      "routes nothing (empty-body 404); use api.intelligence.copilotkit.ai",
  },
  {
    host: "realtime.copilotkit.ai",
    reason: "does not resolve; use realtime.intelligence.copilotkit.ai",
  },
];

/**
 * Paths allowed to name a {@link DEAD_HOSTS} entry.
 *
 * The channels-intelligence test needs a hostname that genuinely does not
 * resolve — that is the condition under test (`getaddrinfo ENOTFOUND`), so
 * substituting a live host would silently void the assertion.
 */
const DEAD_HOST_ALLOWLIST = [
  "packages/channels-intelligence/src/realtime-gateway.test.ts",
  "scripts/validate-intelligence-env-names.ts",
];

interface Violation {
  file: string;
  line: number;
  name: string;
  reason: string;
}

/**
 * Returns `git grep -n` hits for one literal, or `[]` when there are none.
 *
 * `ignoreCase` is for hostnames, which are case-insensitive in DNS and so can
 * appear capitalized in prose. Env var names are case-SENSITIVE, so their rules
 * leave it off.
 */
function grepRepo(
  literal: string,
  ignoreCase = false,
): { file: string; line: number; text: string }[] {
  let out: string;
  try {
    out = execFileSync(
      "git",
      ["grep", "-n", "--fixed-strings", ...(ignoreCase ? ["-i"] : []), literal],
      { cwd: REPO_ROOT, encoding: "utf-8" },
    );
  } catch {
    // git grep exits 1 when there are no matches.
    return [];
  }
  return out
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      const [file, line, ...rest] = row.split(":");
      return { file: file!, line: Number(line), text: rest.join(":") };
    });
}

/** Collects every naming violation in the repository. */
export function findViolations(): Violation[] {
  const violations: Violation[] = [];

  for (const name of RETIRED) {
    for (const hit of grepRepo(name)) {
      if (hit.file === "scripts/validate-intelligence-env-names.ts") continue;
      violations.push({
        file: hit.file,
        line: hit.line,
        name,
        reason: "retired name; use INTELLIGENCE_API_KEY",
      });
    }
  }

  for (const hit of grepRepo(ALIAS)) {
    if (ALIAS_ALLOWLIST.includes(hit.file)) continue;
    // A different credential that merely shares the suffix.
    if (hit.text.includes(`NEXT_PUBLIC_${ALIAS}`)) continue;
    violations.push({
      file: hit.file,
      line: hit.line,
      name: ALIAS,
      reason: "deprecated alias; use INTELLIGENCE_API_KEY",
    });
  }

  for (const { host, reason } of DEAD_HOSTS) {
    for (const hit of grepRepo(host, true)) {
      if (DEAD_HOST_ALLOWLIST.includes(hit.file)) continue;
      violations.push({ file: hit.file, line: hit.line, name: host, reason });
    }
  }

  return violations;
}

function main(): void {
  const violations = findViolations();

  if (violations.length === 0) {
    console.log("Intelligence env var names and hosts are canonical.");
    process.exit(0);
  }

  console.log(
    `Found ${violations.length} non-canonical Intelligence reference${
      violations.length === 1 ? "" : "s"
    }:\n`,
  );
  for (const v of violations) {
    console.log(`  ${v.file}:${v.line}  ${v.name} — ${v.reason}`);
  }
  console.log(
    "\nThe canonical key name is INTELLIGENCE_API_KEY — the name `copilotkit project select`\n" +
      "provisions. The canonical hosts are api.intelligence.copilotkit.ai and\n" +
      "realtime.intelligence.copilotkit.ai. If a site legitimately implements the deprecated\n" +
      "alias fallback, or genuinely needs a non-resolving host, add it to ALIAS_ALLOWLIST or\n" +
      "DEAD_HOST_ALLOWLIST in scripts/validate-intelligence-env-names.ts.",
  );
  process.exit(1);
}

const isDirectRun = typeof require !== "undefined" && require.main === module;

if (isDirectRun) {
  main();
}

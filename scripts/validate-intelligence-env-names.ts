import { execFileSync } from "node:child_process";
import * as path from "node:path";

/**
 * Guards the canonical Intelligence config surface: the project API key's name,
 * and the hostnames that actually serve the managed platform.
 *
 * `CPK_INTELLIGENCE_API_KEY` is what `copilotkit project select` provisions
 * into managed starter `.env` files. Three retired names were live
 * in CopilotKit's own documentation and each
 * produced an undefined key for a reader who followed it with a CLI-provisioned
 * project (OSS-881):
 *
 * - `INTELLIGENCE_API_KEY` — the former project-key name. The CLI and all
 *   current CopilotKit surfaces use `CPK_INTELLIGENCE_API_KEY`.
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
 * Finally it guards the two env vars that feed `CopilotKitIntelligence`'s
 * `apiUrl` and `wsUrl`. Those options resolve to the managed hosts when they are
 * omitted, so supplying a code fallback for either variable silently overrides
 * the one setting that is always correct against the managed service. Every
 * starter route did exactly that, defaulting a managed reader onto a local
 * stack that is not running (OSS-981) — the failure its own `.env.example`
 * warns about. The rule is the pattern rather than the literal: a staging host
 * substituted for localhost would be just as wrong.
 *
 * This is a documentation-drift guard, not a runtime check. It fails on a
 * retired name reappearing anywhere, on the alias appearing outside its
 * allowlist, on a dead host appearing outside its allowlist, and on a managed
 * URL fallback appearing outside its allowlist.
 */

const REPO_ROOT = path.resolve(__dirname, "..");

/** Retired names that must not appear on a current CopilotKit surface. */
const RETIRED = [
  "INTELLIGENCE_API_KEY",
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

/**
 * Env vars that feed `CopilotKitIntelligence`'s `apiUrl` and `wsUrl`. Both
 * options default to the managed hosts when omitted, so a fallback here is
 * never load-bearing — it can only replace a correct default with a worse one.
 */
const MANAGED_URL_ENV_VARS = [
  "INTELLIGENCE_API_URL",
  "INTELLIGENCE_GATEWAY_WS_URL",
] as const;

/** Reported for a code fallback on a {@link MANAGED_URL_ENV_VARS} entry. */
const MANAGED_URL_FALLBACK_REASON =
  "overrides the managed Intelligence default; omit the fallback";

/**
 * Paths allowed to write a managed URL fallback.
 *
 * Both carry the pattern as text — the rule's own definition and its fixtures —
 * so matching them would make the check fail on itself.
 */
const MANAGED_URL_FALLBACK_ALLOWLIST = [
  "scripts/validate-intelligence-env-names.ts",
  "scripts/__tests__/validate-intelligence-env-names.test.ts",
  // Playwright harnesses that stand up a local Intelligence on dedicated ports
  // and drive it with a seed key. Here the fallback is the point: resolving to
  // the managed hosts would aim an offline test suite at production.
  "examples/showcases/banking/playwright.config.ts",
  "examples/showcases/reskinnable-demo/playwright.config.ts",
];

/**
 * Returns the managed URL env var this line supplies a default for, or `null`.
 *
 * Only a `process.env` read can carry a code default. A bare `NAME=value` line
 * in an `.env.example` is a value a reader opts into, not a default that
 * overrides one, so it is left alone; and the conditional-spread form
 * (`...(process.env.X ? { apiUrl: process.env.X } : {})`) is the correct
 * pattern, which passes because it never names a fallback.
 *
 * @param text - One line of source.
 * @returns The offending variable name, or `null` when the line is fine.
 */
export function managedUrlFallback(text: string): string | null {
  for (const name of MANAGED_URL_ENV_VARS) {
    if (
      new RegExp(String.raw`process\.env\.${name}\s*(\?\?|\|\|)`).test(text)
    ) {
      return name;
    }
  }
  return null;
}

/** Reported for an env example that assigns a {@link MANAGED_URL_ENV_VARS} entry. */
const MANAGED_URL_ENV_FILE_REASON =
  "env example sets a managed Intelligence URL; comment it out";

/**
 * Paths allowed to assign a managed URL in an env example.
 *
 * `agentcore/docker` is the local development stack documented in
 * `agentcore/docs/LOCAL_DEVELOPMENT.md`; its whole purpose is a local
 * deployment, so naming one is correct there.
 */
const MANAGED_URL_ENV_FILE_ALLOWLIST = [
  "examples/integrations/agentcore/docker/.env.example",
  // Local demo stacks, each pinned to its own vendored docker-compose ports and
  // seeded org key so the two can run side by side. Both name a local
  // deployment on purpose; neither is a managed-service starting point.
  "examples/showcases/banking/.env.example",
  "examples/showcases/reskinnable-demo/.env.example",
];

/**
 * Returns the managed URL env var this env-file line assigns, or `null`.
 *
 * An `.env.example` is copied to `.env`, so an uncommented assignment hands the
 * reader a value rather than leaving the managed default in place. A commented
 * line documents the self-hosted override without setting it, and an empty
 * assignment is the documented managed setting; both pass.
 *
 * @param text - One line of an env file.
 * @returns The offending variable name, or `null` when the line is fine.
 */
export function managedUrlEnvFileAssignment(text: string): string | null {
  for (const name of MANAGED_URL_ENV_VARS) {
    if (new RegExp(String.raw`^\s*${name}=\S`).test(text)) {
      return name;
    }
  }
  return null;
}

/**
 * Whether a line names `name` itself rather than a longer variable that merely
 * contains it.
 *
 * The grep that finds candidates matches a fixed string, so it also matches
 * every variable the retired name is a substring of — and the canonical
 * `CPK_INTELLIGENCE_API_KEY` ends with the retired project-key name, while
 * `COPILOTKIT_INTELLIGENCE_API_KEY` contains it and has its own {@link RETIRED}
 * entry. Without this boundary the rule reports every correct site in the
 * repository, which is the one failure mode that gets a guard switched off.
 *
 * @param name - The retired variable name being looked for.
 * @param text - One line of source, prose, or an env file.
 * @returns `true` when the line carries that exact name.
 */
export function retiredNameReference(name: string, text: string): boolean {
  return new RegExp(String.raw`(?<![A-Z0-9_])${name}(?![A-Z0-9_])`).test(text);
}

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
      if (!retiredNameReference(name, hit.text)) continue;
      violations.push({
        file: hit.file,
        line: hit.line,
        name,
        reason: "retired name; use CPK_INTELLIGENCE_API_KEY",
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
      reason: "deprecated alias; use the key name consumed by this runtime",
    });
  }

  for (const { host, reason } of DEAD_HOSTS) {
    for (const hit of grepRepo(host, true)) {
      if (DEAD_HOST_ALLOWLIST.includes(hit.file)) continue;
      violations.push({ file: hit.file, line: hit.line, name: host, reason });
    }
  }

  for (const envVar of MANAGED_URL_ENV_VARS) {
    for (const hit of grepRepo(envVar)) {
      if (MANAGED_URL_FALLBACK_ALLOWLIST.includes(hit.file)) continue;
      if (!managedUrlFallback(hit.text)) continue;
      violations.push({
        file: hit.file,
        line: hit.line,
        name: envVar,
        reason: MANAGED_URL_FALLBACK_REASON,
      });
    }
  }

  for (const envVar of MANAGED_URL_ENV_VARS) {
    for (const hit of grepRepo(envVar)) {
      if (!path.basename(hit.file).startsWith(".env")) continue;
      if (MANAGED_URL_ENV_FILE_ALLOWLIST.includes(hit.file)) continue;
      if (!managedUrlEnvFileAssignment(hit.text)) continue;
      violations.push({
        file: hit.file,
        line: hit.line,
        name: envVar,
        reason: MANAGED_URL_ENV_FILE_REASON,
      });
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
    "\n`copilotkit project select` provisions CPK_INTELLIGENCE_API_KEY.\n" +
      "The canonical hosts are api.intelligence.copilotkit.ai and\n" +
      "realtime.intelligence.copilotkit.ai. If a site legitimately implements the deprecated\n" +
      "alias fallback, or genuinely needs a non-resolving host, add it to ALIAS_ALLOWLIST or\n" +
      "DEAD_HOST_ALLOWLIST in scripts/validate-intelligence-env-names.ts.\n\n" +
      "For a managed URL fallback, delete the fallback rather than changing it: apiUrl and\n" +
      "wsUrl already default to the managed hosts when omitted. To keep a self-hosted override\n" +
      "working, spread it conditionally:\n" +
      "  ...(process.env.INTELLIGENCE_API_URL ? { apiUrl: process.env.INTELLIGENCE_API_URL } : {}),",
  );
  process.exit(1);
}

const isDirectRun = typeof require !== "undefined" && require.main === module;

if (isDirectRun) {
  main();
}

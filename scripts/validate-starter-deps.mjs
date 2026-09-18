#!/usr/bin/env node
/**
 * Static dependency-declaration check for the starters under
 * `examples/integrations/`.
 *
 * WHY THIS EXISTS (PE-140)
 * ------------------------
 * Nothing in this repository used to read a starter's dependency manifests.
 * The lefthook pre-commit hook tests `packages/**` only, and the starters are
 * not pnpm workspace members and have no nx targets. A starter could therefore
 * be broken at the dependency-install step and we would learn about it from a
 * developer. That happened twice:
 *
 *   PE-129  `examples/integrations/a2a-middleware/agents/requirements.txt`
 *           declared `a2a-sdk[http-server]` with no version constraint at all.
 *           When a2a-sdk published 1.x it dropped `a2a.server.apps`, and two of
 *           the three agents died on import. No commit of ours was involved.
 *           -> caught here by RULE `python-unconstrained`.
 *
 *   PE-38   `examples/integrations/claude-sdk-python/package.json` used
 *           `recharts`, which declares `react-is` as a peerDependency, but never
 *           declared `react-is` itself. npm papered over it by auto-installing
 *           the unmet peer, recording it in the lockfile as `"peer": true`.
 *           Any resolver that does not auto-install peers (yarn classic,
 *           `--legacy-peer-deps`, a strict pnpm store) gets a different
 *           `react-is` or none at all.
 *           -> caught here by RULE `undeclared-peer`.
 *
 * Both defects are visible in a committed manifest with no network access, so
 * this check is static and runs on every pull request. The companion dynamic
 * check (`.github/workflows/test_starter-clean-install.yml`) installs the
 * starters that the docker smoke matrix does not cover, and catches the case
 * where a still-valid declaration goes bad because an upstream published.
 *
 * RULES
 * -----
 *   npm-floating-tag     A package.json dependency declared as `latest`,
 *                        `next`, `*`, `x` or the empty string, or a git/http
 *                        URL with no `#<ref>` pin. Resolves to whatever exists
 *                        on the day a developer clones.
 *
 *   python-unconstrained A Python dependency declared with NO version operator
 *                        whatsoever. This is PE-129's exact shape.
 *                        DELIBERATELY NOT "no upper bound": `>=`-without-`<`
 *                        appears 40+ times across the fleet and flagging it
 *                        would bury the signal. See the PR for the counts.
 *
 *   undeclared-peer      A top-level package-lock.json entry marked
 *                        `"peer": true` whose name the starter's package.json
 *                        does not declare. `@types/*` are exempt: they are
 *                        type-only, never resolved at runtime, and tsc finds
 *                        them through its own `@types` root lookup.
 *
 * ALLOWLIST
 * ---------
 * Pre-existing violations are listed in ALLOWLIST below with the ticket that
 * owns each one. They print as warnings and do not fail. Anything NOT in the
 * allowlist fails. The list only ever shrinks — do not add to it to make a new
 * starter pass, fix the declaration instead.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const FLOATING_TAGS = new Set(["latest", "next", "*", "x", "X", ""]);
const VERSION_OPERATOR = /[=<>~!]/;

/**
 * Violations that already existed on main when this check landed (2026-09-17).
 * Every rule is an error; these exact (starter, rule, subject) triples are the
 * only exemptions, so a NEW violation anywhere fails immediately.
 *
 * This list only shrinks. A stale entry — one that no longer matches a real
 * violation — is itself a failure, so fixing a starter forces its line out.
 * Do not add to it to make a new starter pass; fix the declaration.
 */
const PYTHON_DEBT = {
  // Every one of these is a runtime dependency with no version operator at
  // all, which is PE-129's exact shape. Each starter needs a pin plus a QA
  // pass against the pinned versions, which is out of scope for the check
  // that found them — see the PE-140 pull request for the per-starter list.
  "a2a-a2ui": ["litellm"],
  adk: [
    "fastapi",
    "uvicorn",
    "python-dotenv",
    "pydantic",
    "google-adk",
    "google-genai",
  ],
  "adk-angular": [
    "fastapi",
    "uvicorn",
    "python-dotenv",
    "pydantic",
    "google-adk",
    "google-genai",
  ],
  "agent-spec": ["uvicorn", "python-dotenv"],
  "ms-agent-framework-python": ["python-dotenv"],
  "pydantic-ai": ["uvicorn", "python-dotenv"],
};

export const ALLOWLIST = Object.entries(PYTHON_DEBT).flatMap(
  ([starter, subjects]) =>
    subjects.map((subject) => ({
      starter,
      rule: "python-unconstrained",
      subject,
      ticket: `PE-140 follow-up (${starter} starter)`,
    })),
);

function isAllowed(violation) {
  return ALLOWLIST.find(
    (a) =>
      a.starter === violation.starter &&
      a.rule === violation.rule &&
      a.subject === violation.subject,
  );
}

// ---------------------------------------------------------------------------
// Manifest readers
// ---------------------------------------------------------------------------

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Drop a trailing TOML comment, but only when the `#` sits outside a quoted
 * string. A PEP 508 direct reference carries its hash in the URL fragment,
 * `"pkg @ https://host/pkg.whl#sha256=..."`, and a blind `replace(/#.*$/)`
 * would eat the closing quote and the rest of the line with it.
 */
export function stripTomlComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * Pull `[project] dependencies` and `[project.optional-dependencies]` out of a
 * pyproject.toml without taking a TOML dependency. Section-aware on purpose:
 * `[tool.poetry] dependencies` and `[build-system] requires` must not leak in.
 */
export function parsePyprojectDeps(text) {
  const deps = [];
  let section = "";
  let inArray = false;
  for (const raw of text.split("\n")) {
    const line = stripTomlComment(raw);
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      section = header[1];
      inArray = false;
      continue;
    }
    const wanted =
      section === "project" || section === "project.optional-dependencies";
    if (!wanted) continue;

    if (!inArray) {
      // `dependencies = [` or `<extra> = [` inside optional-dependencies.
      const key = line.match(/^\s*([A-Za-z0-9._-]+)\s*=\s*\[/);
      if (!key) continue;
      if (section === "project" && key[1] !== "dependencies") continue;
      inArray = true;
      // Fall through so a single-line `dependencies = ["a", "b"]` still parses.
    }
    for (const m of line.matchAll(/"([^"]+)"|'([^']+)'/g)) {
      deps.push(m[1] ?? m[2]);
    }
    // Close the array only on a `]` OUTSIDE a quoted string. A dependency with
    // extras — `"uvicorn[standard]"` — contains a bracket of its own, and
    // testing the raw line would end the array at the first such entry and
    // silently skip every dependency after it.
    if (line.replace(/"[^"]*"|'[^']*'/g, "").includes("]")) inArray = false;
  }
  return deps;
}

export function parseRequirementsTxt(text) {
  const deps = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    deps.push(line);
  }
  return deps;
}

/** Strip extras and environment markers: `a2a-sdk[http-server]>=0.3; x` -> name + spec. */
export function splitRequirement(spec) {
  const withoutMarker = spec.split(";")[0].trim();
  const name = withoutMarker
    .replace(/\[.*?\]/, "")
    .split(VERSION_OPERATOR)[0]
    .trim();
  return {
    name,
    constraint: withoutMarker.slice(name.length).replace(/^\[.*?\]/, ""),
  };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function checkNpmFloatingTags(starter, dir, violations) {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return;
  const pkg = readJson(pkgPath);
  for (const field of ["dependencies", "devDependencies"]) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      const value = String(range).trim();
      const unpinnedUrl =
        /^(https?:|git\+|github:|git:)/.test(value) && !value.includes("#");
      if (FLOATING_TAGS.has(value) || unpinnedUrl) {
        violations.push({
          starter,
          rule: "npm-floating-tag",
          subject: name,
          manifest: path.join("examples/integrations", starter, "package.json"),
          detail: `${field}."${name}" is declared as "${value}", which resolves to whatever is published on the day a developer clones.`,
          fix: `Pin ${name} to the range the starter is known to work against.`,
        });
      }
    }
  }
}

function checkUndeclaredPeers(starter, dir, violations) {
  const lockPath = path.join(dir, "package-lock.json");
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(lockPath) || !fs.existsSync(pkgPath)) return;
  const lock = readJson(lockPath);
  const pkg = readJson(pkgPath);
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);

  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!entry?.peer) continue;
    // Top-level only. A peer nested under `x/node_modules/y` is physically
    // present for its requirer under every resolver, so it is not at risk.
    if (!key.startsWith("node_modules/")) continue;
    const name = key.slice("node_modules/".length);
    if (name.includes("/node_modules/")) continue;
    // Type-only packages are never resolved at runtime and tsc finds them via
    // its own `@types` root lookup regardless of who declares them.
    if (name.startsWith("@types/")) continue;
    if (declared.has(name)) continue;

    const requiredBy = Object.entries(lock.packages ?? {})
      .filter(([, e]) => e?.peerDependencies && name in e.peerDependencies)
      .map(([k]) => k.replace(/^node_modules\//, ""))
      .slice(0, 3);

    violations.push({
      starter,
      rule: "undeclared-peer",
      subject: name,
      manifest: path.join("examples/integrations", starter, "package.json"),
      detail:
        `package-lock.json installs "${name}@${entry.version}" only to satisfy an unmet peer dependency of ` +
        `${requiredBy.length ? requiredBy.join(", ") : "another package"}, and package.json does not declare it. ` +
        `Resolvers that do not auto-install peers get a different version, or none.`,
      fix: `Add "${name}" to dependencies in examples/integrations/${starter}/package.json and refresh the lockfile.`,
    });
  }
}

function pythonManifests(dir) {
  const out = [];
  const walk = (current, depth) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (
        e.name === "node_modules" ||
        e.name === ".venv" ||
        e.name.startsWith(".")
      )
        continue;
      const full = path.join(current, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name === "requirements.txt" || e.name === "pyproject.toml")
        out.push(full);
    }
  };
  walk(dir, 0);
  return out;
}

/** Keys under `[tool.uv.sources]`, i.e. deps resolved from the working tree. */
export function parseUvSources(text) {
  const names = new Set();
  let section = "";
  for (const raw of text.split("\n")) {
    const line = stripTomlComment(raw);
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      section = header[1];
      continue;
    }
    if (section !== "tool.uv.sources") continue;
    const key = line.match(/^\s*"?([A-Za-z0-9._-]+)"?\s*=/);
    if (key) names.add(key[1]);
  }
  return names;
}

/** True when `name` names a package that lives inside the starter itself. */
export function isWorkspaceSibling(name, starterDir, manifestDir, uvSources) {
  if (uvSources?.has(name)) return true;
  const candidates = [name, name.replace(/-/g, "_")];
  return candidates.some(
    (c) =>
      fs.existsSync(path.join(starterDir, c)) ||
      fs.existsSync(path.join(manifestDir, c)),
  );
}

function checkPythonConstraints(starter, dir, repoRoot, violations) {
  // A uv workspace declares its local members at the starter root, so collect
  // sources from every pyproject in the starter, not just the current one.
  const uvSources = new Set();
  for (const manifest of pythonManifests(dir)) {
    if (!manifest.endsWith("pyproject.toml")) continue;
    for (const n of parseUvSources(fs.readFileSync(manifest, "utf8")))
      uvSources.add(n);
  }

  for (const manifest of pythonManifests(dir)) {
    const text = fs.readFileSync(manifest, "utf8");
    const specs = manifest.endsWith("pyproject.toml")
      ? parsePyprojectDeps(text)
      : parseRequirementsTxt(text);

    for (const spec of specs) {
      const { name, constraint } = splitRequirement(spec);
      if (!name) continue;
      if (VERSION_OPERATOR.test(constraint)) continue;
      // A sibling package inside the same starter (a uv/hatch workspace member)
      // is resolved from the working tree, not from PyPI, so a PyPI-style
      // version constraint would be meaningless.
      if (isWorkspaceSibling(name, dir, path.dirname(manifest), uvSources))
        continue;

      violations.push({
        starter,
        rule: "python-unconstrained",
        subject: name,
        manifest: path.relative(repoRoot, manifest),
        detail: `"${spec}" carries no version constraint, so a clean install takes whatever PyPI serves that day. This is exactly how PE-129 broke.`,
        fix: `Give ${name} a constraint with an upper bound, e.g. "${name}>=X.Y,<Z".`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function validateStarterDeps(integrationsDir, repoRoot = process.cwd()) {
  const violations = [];
  const entries = fs.readdirSync(integrationsDir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    // `_parity` holds the shared parity fixtures, not a starter.
    if (entry.name.startsWith("_")) continue;
    const dir = path.join(integrationsDir, entry.name);
    checkNpmFloatingTags(entry.name, dir, violations);
    checkUndeclaredPeers(entry.name, dir, violations);
    checkPythonConstraints(entry.name, dir, repoRoot, violations);
  }
  return violations;
}

function main() {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const integrationsDir = path.join(repoRoot, "examples", "integrations");
  const violations = validateStarterDeps(integrationsDir, repoRoot);

  const failures = [];
  const allowed = [];
  for (const v of violations) {
    const entry = isAllowed(v);
    if (entry) allowed.push({ ...v, ticket: entry.ticket });
    else failures.push(v);
  }

  if (allowed.length > 0) {
    console.log(
      `Known starter dependency debt (${allowed.length}, allowlisted):`,
    );
    for (const v of allowed) {
      console.log(
        `  - ${v.starter}: ${v.rule} ${v.subject} [${v.manifest}] -> ${v.ticket}`,
      );
    }
    console.log("");
  }

  // The allowlist must only ever shrink. An entry that no longer matches a
  // real violation means the starter was fixed and the exemption is now
  // decoration, so it has to come out in the same change.
  const stale = ALLOWLIST.filter(
    (a) =>
      !violations.some(
        (v) =>
          v.starter === a.starter &&
          v.rule === a.rule &&
          v.subject === a.subject,
      ),
  );
  if (stale.length > 0) {
    console.error("");
    console.error(
      "::error::scripts/validate-starter-deps.mjs has stale allowlist entries — the starter was fixed, so delete them:",
    );
    for (const a of stale) {
      console.error(`  - ${a.starter}: ${a.rule} "${a.subject}"`);
    }
    return 1;
  }

  if (failures.length === 0) {
    console.log(
      `Starter dependency declarations OK — no new violations across ${
        fs
          .readdirSync(integrationsDir, { withFileTypes: true })
          .filter((e) => e.isDirectory() && !e.name.startsWith("_")).length
      } starters.`,
    );
    return 0;
  }

  const byStarter = new Map();
  for (const v of failures) {
    if (!byStarter.has(v.starter)) byStarter.set(v.starter, []);
    byStarter.get(v.starter).push(v);
  }

  console.error("");
  console.error("Starter dependency declaration check FAILED.");
  console.error("");
  for (const [starter, list] of byStarter) {
    console.error(
      `::error::starter "${starter}" has ${list.length} dependency declaration violation(s)`,
    );
    for (const v of list) {
      console.error(`  starter:  ${starter}`);
      console.error(`  manifest: ${v.manifest}`);
      console.error(`  rule:     ${v.rule} (${v.subject})`);
      console.error(`  problem:  ${v.detail}`);
      console.error(`  fix:      ${v.fix}`);
      console.error("");
    }
  }
  console.error(
    "See scripts/validate-starter-deps.mjs for why each rule exists (PE-129, PE-38).",
  );
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}

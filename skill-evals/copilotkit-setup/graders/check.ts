/**
 * Deterministic correctness grader for the copilotkit-setup skill eval.
 *
 * CONTRACT: prints a single JSON object to stdout:
 *   {"score": 0-1, "details": "...", "checks": [{"name","passed","message"}, ...]}
 *
 * Runs in the post-agent container (node:20-slim) via `tsx /eval-tools/check.ts`,
 * grading /workspace. TypeScript on purpose — it shares the same `tsx` runner the
 * host harness (lift/run.ts) uses, so the whole eval is one language with no
 * jq/awk/bc shelling. Score math is plain JS; JSON is native.
 *
 * WHAT THIS GRADES: the agent was asked to add CopilotKit to an existing
 * Vite+React app at /workspace — frontend @copilotkit/react-core, a backend
 * (Express/Hono) running a CopilotRuntime + BuiltInAgent via @copilotkit/runtime,
 * the <CopilotKit> provider, a CopilotSidebar (or other chat UI), and the
 * stylesheet import. The backend may live at root or in a subdir (e.g. server/).
 *
 * THE GATE: this grader actually TYPE-CHECKS the project — it does not merely
 * grep for API names. A project that does not type-check is not a working setup.
 * For every project dir with a package.json (the root vite app + any backend
 * subdir) we run a type-check (the dir's own `typecheck` npm script if defined,
 * else `npx tsc --noEmit -p <dir>`). Type-check is THE dominant signal.
 *
 * SCORING:
 *   total = 0.60 * GATE + 0.40 * STRINGS
 *   - GATE    = fraction of discovered project dirs whose type-check exits 0.
 *               If no project dir is found, GATE = 0.
 *   - STRINGS = fraction of the 7 source/string checks that pass.
 *   A non-compiling project drives GATE toward 0, capping the score well below
 *   the 0.8 threshold (max ~0.40) even if every string is present.
 *
 * GRADER-POISONING GUARD: the WITH-skill arm copies the skill (incl. its
 * assets/*.tsx example code) into /workspace/.claude/skills. EVERY source scan
 * and package.json find MUST exclude that dir (and .agents, node_modules) or a
 * no-op agent scores points off the skill's own examples.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";

const WORKSPACE = process.env.WORKSPACE || "/workspace";

// Directories that are never the agent's own work: dependency trees, VCS, build
// output, and the mounted-skill copies. Excluded from BOTH dir discovery and
// source scans.
const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  ".agents",
  ".claude",
  "dist",
  "build",
]);

const SOURCE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);

interface Check {
  name: string;
  passed: boolean;
  message: string;
}

const checks: Check[] = [];
let stringPass = 0;
let stringTotal = 0;

/** Record a check that does NOT count toward the string fraction (e.g. the gate). */
function addCheck(name: string, passed: boolean, message: string): void {
  checks.push({ name, passed, message });
}

/** Record one of the 7 weighted string checks. */
function addStringCheck(name: string, passed: boolean, message: string): void {
  stringTotal++;
  if (passed) stringPass++;
  checks.push({ name, passed, message });
}

function truncate(s: string, n = 400): string {
  return s.length > n ? `${s.slice(0, n)}…(truncated)` : s;
}

/** Walk WORKSPACE, applying `visit(absPath)` to every file, skipping EXCLUDE_DIRS. */
function walk(dir: string, visit: (file: string) => void): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), visit);
    } else if (entry.isFile()) {
      visit(path.join(dir, entry.name));
    }
  }
}

// --- gather: package.json dirs, dependency names, source file contents --------

const pkgFiles: string[] = [];
const depNames = new Set<string>();
const sourceFiles: string[] = [];

walk(WORKSPACE, (file) => {
  const base = path.basename(file);
  if (base === "package.json") {
    pkgFiles.push(file);
    try {
      const pkg = JSON.parse(readFileSync(file, "utf8"));
      for (const field of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
      ]) {
        for (const name of Object.keys(pkg[field] || {})) depNames.add(name);
      }
    } catch {
      /* malformed package.json — ignore for dep scan, gate still type-checks it */
    }
    return;
  }
  if (SOURCE_EXTS.has(path.extname(file))) sourceFiles.push(file);
});

/** True if ANY source file matches `re`. */
function srcMatch(re: RegExp): boolean {
  return sourceFiles.some((f) => {
    try {
      return re.test(readFileSync(f, "utf8"));
    } catch {
      return false;
    }
  });
}

// --- 1. THE GATE: type-check every project dir --------------------------------

let gateTotal = 0;
let gatePass = 0;

if (pkgFiles.length === 0) {
  addCheck(
    "type-check (gate)",
    false,
    "No package.json found in workspace — cannot type-check any project.",
  );
} else {
  for (const pkgFile of pkgFiles) {
    const dir = path.dirname(pkgFile);
    gateTotal++;

    // The agent should have installed deps; a backend subdir may be uninstalled.
    if (!existsSync(path.join(dir, "node_modules"))) {
      try {
        execFileSync("npm", ["install"], { cwd: dir, stdio: "ignore" });
      } catch {
        /* install failure surfaces as a type-check failure below */
      }
    }

    let hasTypecheckScript = false;
    try {
      const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
      hasTypecheckScript = Boolean(pkg.scripts && pkg.scripts.typecheck);
    } catch {
      /* handled by gate failure */
    }

    const rel = path.relative(WORKSPACE, dir) || "(root)";
    try {
      if (hasTypecheckScript) {
        execFileSync("npm", ["run", "typecheck"], { cwd: dir, stdio: "pipe" });
      } else {
        execFileSync("npx", ["--yes", "tsc", "--noEmit", "-p", dir], {
          cwd: dir,
          stdio: "pipe",
        });
      }
      gatePass++;
      addCheck(`type-check: ${rel}`, true, "Type-check passed.");
    } catch (err) {
      const e = err as { stdout?: Buffer | string; stderr?: Buffer | string };
      const out = `${e.stdout || ""}${e.stderr || ""}`.toString();
      addCheck(
        `type-check: ${rel}`,
        false,
        `Type-check FAILED: ${truncate(out.slice(-600))}`,
      );
    }
  }
}

// --- 2-3. Packages present ----------------------------------------------------

addStringCheck(
  "frontend package (@copilotkit/react-core)",
  depNames.has("@copilotkit/react-core"),
  depNames.has("@copilotkit/react-core")
    ? "Found in a package.json dependency list."
    : "@copilotkit/react-core not found in any package.json.",
);

addStringCheck(
  "runtime package (@copilotkit/runtime)",
  depNames.has("@copilotkit/runtime"),
  depNames.has("@copilotkit/runtime")
    ? "Found in a package.json dependency list."
    : "@copilotkit/runtime not found in any package.json.",
);

// --- 4. Canonical handler factory (deprecated createCopilotEndpoint* excluded) -

const hasHandler = srcMatch(/createCopilot(Express|Hono)Handler/);
addStringCheck(
  "canonical handler factory",
  hasHandler,
  hasHandler
    ? "createCopilotExpressHandler or createCopilotHonoHandler present in source."
    : "Neither createCopilotExpressHandler nor createCopilotHonoHandler found (deprecated createCopilotEndpoint* does not count).",
);

// --- 5. BuiltInAgent configured ----------------------------------------------

const hasBuiltIn = srcMatch(/BuiltInAgent/);
addStringCheck(
  "BuiltInAgent configured",
  hasBuiltIn,
  hasBuiltIn
    ? "BuiltInAgent present in source."
    : "BuiltInAgent not found in source.",
);

// --- 6. Provider <CopilotKit> from react-core/v2 -----------------------------
// <CopilotKit ...> element (regex excludes the legacy <CopilotKitProvider>) AND
// imported from @copilotkit/react-core/v2.

const providerElem = srcMatch(/<CopilotKit([^A-Za-z]|$)/);
const providerImport = srcMatch(/@copilotkit\/react-core\/v2/);
addStringCheck(
  "provider <CopilotKit> from react-core/v2",
  providerElem && providerImport,
  providerElem && providerImport
    ? "<CopilotKit> element and @copilotkit/react-core/v2 import both present."
    : `Need <CopilotKit> element (not <CopilotKitProvider>) AND @copilotkit/react-core/v2 import. element=${providerElem} import=${providerImport}`,
);

// --- 7. Chat UI component -----------------------------------------------------

const hasChat = srcMatch(/CopilotSidebar|CopilotChat|CopilotPopup/);
addStringCheck(
  "chat UI component",
  hasChat,
  hasChat
    ? "CopilotSidebar / CopilotChat / CopilotPopup present in source."
    : "No CopilotSidebar / CopilotChat / CopilotPopup found in source.",
);

// --- 8. Stylesheet imported ---------------------------------------------------

const hasStyles = srcMatch(/@copilotkit\/react-core\/v2\/styles\.css/);
addStringCheck(
  "stylesheet imported",
  hasStyles,
  hasStyles
    ? "@copilotkit/react-core/v2/styles.css import present."
    : "@copilotkit/react-core/v2/styles.css import not found.",
);

// --- Score --------------------------------------------------------------------

const gate = gateTotal > 0 ? gatePass / gateTotal : 0;
const strings = stringTotal > 0 ? stringPass / stringTotal : 0;
const score = Number((0.6 * gate + 0.4 * strings).toFixed(4));

const details =
  `Type-check gate: ${gatePass}/${gateTotal} project dir(s) passed (weight 0.60). ` +
  `String checks: ${stringPass}/${stringTotal} passed (weight 0.40). Score=${score}.`;

process.stdout.write(`${JSON.stringify({ score, details, checks })}\n`);

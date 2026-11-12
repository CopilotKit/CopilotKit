#!/usr/bin/env node
// End-to-end check of the v2-migration codemod on real apps.
//
// For each example of a git ref (default `origin/main`, the v1 line), the
// harness copies the example into a scratch git repo, points its
// `@copilotkit/*` dependencies at tarballs of the 2.0 packages, installs, and
// type-checks it twice: before the codemod and after it. It also runs the
// codemod a second time (the second run must change nothing) and scans the
// result for v1 imports the codemod left behind.
//
// Usage:
//   node codemods/v2-migration/e2e/run-examples.mjs \
//     --tarballs <dir> --out <dir> [--ref origin/main] [--only <substring>]
//     [--concurrency 6] [--skip-install]
//
// Build the tarballs first: `pnpm pack` every public package under packages/
// into one directory (see README.md next to this file).

import { execFile as execFileCb, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCb);
const here = path.dirname(fileURLToPath(import.meta.url));
const codemodDir = path.resolve(here, "..");
const repoRoot = path.resolve(codemodDir, "../..");
const codemodBin = path.join(codemodDir, "node_modules/.bin/codemod");
const workflow = path.join(codemodDir, "workflow.yaml");
const fallbackTsc = path.join(repoRoot, "node_modules/.bin/tsc");

// ---------------------------------------------------------------------------
// Arguments

function parseArgs(argv) {
  const args = { ref: "origin/main", concurrency: 6, only: [] };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const next = () => argv[++i];
    if (key === "--tarballs") args.tarballs = path.resolve(next());
    else if (key === "--out") args.out = path.resolve(next());
    else if (key === "--ref") args.ref = next();
    else if (key === "--only") args.only.push(next());
    else if (key === "--concurrency") args.concurrency = Number(next());
    else if (key === "--skip-install") args.skipInstall = true;
    else throw new Error(`Unknown argument ${key}`);
  }
  if (!args.tarballs || !args.out) {
    throw new Error("--tarballs and --out are required");
  }
  return args;
}

// ---------------------------------------------------------------------------
// Helpers

async function run(cmd, argv, opts = {}) {
  try {
    const { stdout, stderr } = await execFile(cmd, argv, {
      maxBuffer: 256 * 1024 * 1024,
      timeout: opts.timeout ?? 10 * 60 * 1000,
      ...opts,
      env: { ...process.env, CI: "1", ...opts.env },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr:
        (error.stderr ?? "") + (error.killed ? "\n[killed: timeout]" : ""),
    };
  }
}

const git = (cwd, ...argv) =>
  run("git", ["-c", "user.email=e2e@local", "-c", "user.name=e2e", ...argv], {
    cwd,
  });

function walk(dir, visit, rel = "") {
  for (const entry of fs.readdirSync(path.join(dir, rel), {
    withFileTypes: true,
  })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const child = path.join(rel, entry.name);
    if (entry.isDirectory()) walk(dir, visit, child);
    else visit(child);
  }
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function copilotkitDeps(pkg) {
  const names = new Set();
  for (const field of DEP_FIELDS) {
    for (const name of Object.keys(pkg[field] ?? {})) {
      if (name.startsWith("@copilotkit/")) names.add(name);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// Which examples, and which projects inside each

async function listExamples(ref) {
  const { stdout } = await run("git", [
    "-C",
    repoRoot,
    "ls-tree",
    "-r",
    "--name-only",
    ref,
    "examples",
  ]);
  const roots = new Set();
  for (const file of stdout.split("\n")) {
    if (!file.endsWith("package.json") || file.includes("node_modules/")) {
      continue;
    }
    const parts = file.split("/");
    // examples/<group>/<name>/... ; a top-level example is examples/<name>/...
    const groupHasChildren = parts.length > 3;
    roots.add(parts.slice(0, groupHasChildren ? 3 : 2).join("/"));
  }
  return [...roots].sort();
}

/** Directories (relative to the app) that use CopilotKit and have a tsconfig. */
function findProjects(appDir) {
  const projects = [];
  walk(appDir, (rel) => {
    if (path.basename(rel) !== "package.json") return;
    const dir = path.dirname(rel);
    const pkg = readJson(path.join(appDir, rel));
    if (copilotkitDeps(pkg).size === 0) return;
    projects.push({
      dir,
      hasTsconfig: fs.existsSync(path.join(appDir, dir, "tsconfig.json")),
    });
  });
  return projects;
}

/** The nearest directory at or above `dir` (inside the app) with a pnpm workspace. */
function installRootFor(appDir, dir) {
  let current = dir;
  for (;;) {
    if (fs.existsSync(path.join(appDir, current, "pnpm-workspace.yaml"))) {
      return current;
    }
    if (current === "." || current === "") return dir;
    current = path.dirname(current);
  }
}

// ---------------------------------------------------------------------------
// Workspace dependencies of the examples that live in the monorepo

/** v1 packages that 2.0 does not ship. The migrated app must not need them. */
const V1_ONLY = new Set([
  "@copilotkit/react-ui",
  "@copilotkit/react-textarea",
  "@copilotkit/runtime-client-gql",
]);

/** Package name to its directory at the ref, for every package.json there. */
async function packageIndex(ref) {
  const { stdout } = await run("git", [
    "-C",
    repoRoot,
    "ls-tree",
    "-r",
    "--name-only",
    ref,
  ]);
  const files = stdout
    .split("\n")
    .filter((f) => f.endsWith("/package.json") && !f.includes("node_modules/"));
  const index = new Map();
  for (const file of files) {
    const shown = await run("git", ["-C", repoRoot, "show", `${ref}:${file}`]);
    try {
      const name = JSON.parse(shown.stdout).name;
      if (name && !index.has(name)) index.set(name, path.dirname(file));
    } catch {
      // Not JSON (a template): skip it.
    }
  }
  return index;
}

/** A copy of a monorepo package at the ref, for `file:` dependencies. */
async function vendor(args, index, name) {
  const dir = index.get(name);
  if (!dir) return null;
  const target = path.join(args.out, "vendor", name.replace(/\//g, "__"));
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
    await run("sh", [
      "-c",
      `git -C "${repoRoot}" archive "${args.ref}" "${dir}" | tar -x -C "${target}" --strip-components=${dir.split("/").length}`,
    ]);
  }
  return `file:${target}`;
}

/** Rewrites `workspace:` dependencies that the tarballs do not cover. */
async function resolveWorkspaceDeps(file, args, index, tarballs) {
  const pkg = readJson(file);
  for (const field of DEP_FIELDS) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (typeof spec !== "string" || !spec.startsWith("workspace:")) continue;
      if (tarballs[name]) continue;
      if (V1_ONLY.has(name)) {
        delete pkg[field][name];
        continue;
      }
      const vendored = await vendor(args, index, name);
      if (vendored) pkg[field][name] = vendored;
      else delete pkg[field][name];
    }
  }
  writeJson(file, pkg);
}

const usesWorkspaceProtocol = (file) =>
  /"workspace:/.test(fs.readFileSync(file, "utf8"));

/**
 * Copies the tsconfig files that the app's tsconfigs extend from outside the
 * app (`../../../packages/tsconfig/nextjs.json` in a monorepo example) to the
 * same relative place in the scratch tree, so the type check uses the app's
 * real compiler options. `rootEquivalent` stands for the repo root.
 */
async function materializeExtends(
  args,
  file,
  appDir,
  rootEquivalent,
  seen = new Set(),
) {
  if (seen.has(file) || !fs.existsSync(file)) return;
  seen.add(file);
  let config;
  try {
    // tsconfig allows comments and trailing commas.
    const text = fs
      .readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "")
      .replace(/,(\s*[}\]])/g, "$1");
    config = JSON.parse(text);
  } catch {
    return;
  }
  const parents = [config.extends ?? []].flat();
  for (const parent of parents) {
    if (typeof parent !== "string" || !parent.startsWith(".")) continue;
    let target = path.resolve(path.dirname(file), parent);
    if (!target.endsWith(".json")) target += ".json";
    if (!path.relative(appDir, target).startsWith("..")) {
      await materializeExtends(args, target, appDir, rootEquivalent, seen);
      continue;
    }
    const repoRel = path.relative(rootEquivalent, target);
    if (repoRel.startsWith("..")) continue;
    if (!fs.existsSync(target)) {
      const shown = await run("git", [
        "-C",
        repoRoot,
        "show",
        `${args.ref}:${repoRel}`,
      ]);
      if (shown.code !== 0) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, shown.stdout);
    }
    await materializeExtends(args, target, appDir, rootEquivalent, seen);
  }
}

// ---------------------------------------------------------------------------
// Tarballs

function tarballMap(dir) {
  const map = {};
  for (const file of fs.readdirSync(dir)) {
    const match = /^copilotkit-(.+)-\d+\.\d+\.\d+(?:-[\w.]+)?\.tgz$/.exec(file);
    if (match) map[`@copilotkit/${match[1]}`] = `file:${path.join(dir, file)}`;
  }
  return map;
}

function pointAtTarballs(file, tarballs, { isInstallRoot }) {
  const pkg = readJson(file);
  for (const field of DEP_FIELDS) {
    for (const name of Object.keys(pkg[field] ?? {})) {
      if (tarballs[name] && field !== "peerDependencies") {
        pkg[field][name] = tarballs[name];
      }
    }
  }
  if (isInstallRoot) {
    pkg.pnpm = {
      ...pkg.pnpm,
      overrides: { ...pkg.pnpm?.overrides, ...tarballs },
    };
  }
  // Scripts such as `postinstall: uv sync` set up agents, not the frontend.
  writeJson(file, pkg);
}

// ---------------------------------------------------------------------------
// Type check

const TSC_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

async function typecheck(appDir, project) {
  const cwd = path.join(appDir, project.dir);
  // A Vue project needs vue-tsc: plain tsc cannot read `.vue` imports.
  const vueTsc = path.join(cwd, "node_modules/.bin/vue-tsc");
  const local = path.join(cwd, "node_modules/.bin/tsc");
  const tsc = fs.existsSync(vueTsc)
    ? vueTsc
    : fs.existsSync(local)
      ? local
      : fallbackTsc;
  const result = await run(tsc, ["--noEmit", "-p", "."], {
    cwd,
    timeout: 8 * 60 * 1000,
  });
  const errors = [];
  let current = null;
  for (const line of (result.stdout + result.stderr).split("\n")) {
    const match = TSC_LINE.exec(line);
    if (match) {
      current = {
        file: path.join(project.dir, match[1]),
        line: Number(match[2]),
        code: match[4],
        message: match[5],
      };
      errors.push(current);
    } else if (current && /^\s+/.test(line) && line.trim()) {
      current.message += " " + line.trim();
    }
  }
  return {
    ok: result.code === 0,
    errors,
    raw:
      errors.length === 0 && result.code !== 0
        ? result.stdout + result.stderr
        : "",
  };
}

// ---------------------------------------------------------------------------
// Classification

const TODO = "TODO(copilotkit-2.0)";

function hasTodoNear(appDir, file, line) {
  try {
    const lines = fs.readFileSync(path.join(appDir, file), "utf8").split("\n");
    // Above the error, or inside the statement it starts (a TODO before a
    // property of a call reported on the call's first line).
    for (
      let i = Math.max(0, line - 6);
      i < Math.min(lines.length, line + 8);
      i++
    ) {
      if (lines[i].includes(TODO)) return true;
    }
  } catch {
    // An error in a file we cannot read is not near a TODO.
  }
  return false;
}

const MODULE_ERROR =
  /Cannot find module '([^']+)'|has no exported member|Module '"([^"]+)"' has no exported member/;

function packageOf(specifier) {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function classify(appDir, error, beforeKeys, originalKeys) {
  const key = `${error.file}|${error.code}|${error.message}`;
  if (originalKeys.has(key)) return "app";
  const missing = /Cannot find module '([^']+)'/.exec(error.message);
  if (missing) {
    const pkg = packageOf(missing[1]);
    if (pkg?.startsWith("@copilotkit/")) return "copilotkit-import";
    if (pkg) return beforeKeys.has(key) ? "pre-existing" : "missing-dep";
  }
  if (hasTodoNear(appDir, error.file, error.line)) return "todo";
  if (beforeKeys.has(key)) return "unchanged";
  return "unexplained";
}

/**
 * The zod a package declares in its tarball, or `undefined` without one.
 */
function tarballZodRange(tarball) {
  if (!tarball) return undefined;
  const manifest = execFileSync(
    "tar",
    ["-xOzf", tarball.replace(/^file:/, ""), "package/package.json"],
    { encoding: "utf8" },
  );
  return JSON.parse(manifest).dependencies?.zod;
}

/**
 * One zod major for the app, as the skill says: `@ag-ui/client` has zod as a
 * peer, and two zod majors install two `AbstractAgent` copies. A2UI is the
 * exception: `@a2ui/web_core` reads zod 3 internals to bind catalog props, so
 * it and the renderer keep the zod they declare.
 */
function zodOverrides(tarballs) {
  const renderer = tarballZodRange(tarballs["@copilotkit/a2ui-renderer"]);
  return {
    zod: COMPANION_VERSIONS.zod,
    "@a2ui/web_core>zod": "^3.25.76",
    ...(renderer && { "@copilotkit/a2ui-renderer>zod": renderer }),
  };
}

// ---------------------------------------------------------------------------
// The dependency step of the migration skill (`agents/skill/v2-migration`):
// add the packages that the migrated code now imports.

/** Versions the 2.0 packages use; anything else installs as `latest`. */
const COMPANION_VERSIONS = {
  zod: "^4.2.0",
  "@ag-ui/client": "1.0.4",
  "@ag-ui/core": "1.0.4",
  "@ag-ui/encoder": "1.0.4",
  "@ag-ui/langgraph": "latest",
  "@tanstack/ai": "^1.2.0",
  "@tanstack/ai-openai": "^1.1.1",
  "@tanstack/ai-anthropic": "^1.1.1",
  "@tanstack/ai-gemini": "^1.1.1",
  "@tanstack/ai-mcp": "^1.1.0",
};

/** Packages that a missing-dependency error names, by project. */
function missingPackages(after) {
  const byProject = new Map();
  for (const [dir, result] of Object.entries(after)) {
    for (const error of result.errors) {
      if (error.kind !== "missing-dep") continue;
      const match = /Cannot find module '([^']+)'/.exec(error.message);
      const pkg = match && packageOf(match[1]);
      if (!pkg || !(pkg in COMPANION_VERSIONS)) continue;
      byProject.set(dir, (byProject.get(dir) ?? new Set()).add(pkg));
    }
  }
  return byProject;
}

// ---------------------------------------------------------------------------
// Leftovers: v1 surface the migrated code still imports

const LEFTOVERS = [
  [/["']@copilotkit\/react-ui["']/, "@copilotkit/react-ui import"],
  [/["']@copilotkit\/react-textarea["']/, "@copilotkit/react-textarea import"],
  [
    /["']@copilotkit\/runtime-client-gql["']/,
    "@copilotkit/runtime-client-gql import",
  ],
  [
    /["']@copilotkit\/(react-core|runtime|shared)\/v2(\/[^"']*)?["']/,
    "/v2 subpath import",
  ],
  [/["']@copilotkit\/[^"']*styles\.css["']/, "stylesheet import"],
];

function scanLeftovers(appDir) {
  const hits = [];
  walk(appDir, (rel) => {
    if (!/\.(tsx?|jsx?|mjs|cjs|mts|cts)$/.test(rel) || rel.endsWith(".d.ts")) {
      return;
    }
    if (/(^|\/)(\.next|dist|build)\//.test(rel)) return;
    const lines = fs.readFileSync(path.join(appDir, rel), "utf8").split("\n");
    lines.forEach((text, index) => {
      for (const [pattern, label] of LEFTOVERS) {
        if (!pattern.test(text)) continue;
        const flagged =
          text.includes(TODO) ||
          lines
            .slice(Math.max(0, index - 4), index)
            .some((l) => l.includes(TODO));
        hits.push({
          file: rel,
          line: index + 1,
          label,
          flagged,
          text: text.trim(),
        });
      }
    });
  });
  return hits;
}

// ---------------------------------------------------------------------------
// One example

async function runCodemod(appDir) {
  const started = Date.now();
  const result = await run(
    codemodBin,
    [
      "workflow",
      "run",
      "-w",
      workflow,
      "-t",
      ".",
      "--no-interactive",
      "--allow-dirty",
      "--disable-analytics",
      "--no-color",
    ],
    { cwd: appDir, timeout: 10 * 60 * 1000 },
  );
  const output = result.stdout + result.stderr;
  return {
    ok:
      result.code === 0 &&
      !/error|panic|failed/i.test(output.replace(/Workflow completed.*/g, "")),
    code: result.code,
    ms: Date.now() - started,
    output: output.slice(-4000),
  };
}

async function runExample(example, args, tarballs, index) {
  const slug = example.replace(/^examples\//, "").replace(/\//g, "__");
  const workDir = path.join(args.out, "work", slug);
  const appDir = path.join(workDir, "app");
  const report = { example, slug, steps: {} };
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });

  // 1. A copy of the example at the ref, in a git repo of its own.
  const archive = await run("sh", [
    "-c",
    `git -C "${repoRoot}" archive "${args.ref}" "${example}" | tar -x -C "${workDir}" && cp -R "${workDir}/${example}/." "${appDir}/" && rm -rf "${workDir}/examples"`,
  ]);
  if (archive.code !== 0) {
    report.steps.archive = { ok: false, output: archive.stderr };
    return report;
  }
  fs.mkdirSync(path.join(appDir, ".git"), { recursive: true });
  await git(appDir, "init", "-q");
  fs.writeFileSync(
    path.join(appDir, ".git/info/exclude"),
    "node_modules\n.next\ndist\n.turbo\n*.tsbuildinfo\nnext-env.d.ts\n",
  );
  await git(appDir, "add", "-A");
  await git(appDir, "commit", "-qm", "original", "--no-verify");

  const projects = findProjects(appDir);
  report.projects = projects;
  const tsProjects = projects.filter((p) => p.hasTsconfig);
  const installRoots = new Set(
    tsProjects.map((p) => installRootFor(appDir, p.dir)),
  );
  const rootEquivalent = path.resolve(
    appDir,
    "../".repeat(example.split("/").length),
  );
  for (const project of tsProjects) {
    await materializeExtends(
      args,
      path.join(appDir, project.dir, "tsconfig.json"),
      appDir,
      rootEquivalent,
    );
  }

  // 1b. The original app on its own (1.x) packages: its type errors are the
  // app's, not the migration's. An example that depends on the monorepo
  // (`workspace:`) has no published versions to install, so it has none.
  report.original = {};
  const standalone = [...installRoots].every(
    (root) => !usesWorkspaceProtocol(path.join(appDir, root, "package.json")),
  );
  if (!args.skipInstall && tsProjects.length > 0 && standalone) {
    const origDir = path.join(workDir, "original");
    fs.cpSync(appDir, origDir, { recursive: true });
    let installed = true;
    for (const root of installRoots) {
      const result = await run(
        "pnpm",
        [
          "install",
          "--no-frozen-lockfile",
          "--ignore-scripts",
          "--prefer-offline",
          "--reporter=silent",
        ],
        { cwd: path.join(origDir, root), timeout: 15 * 60 * 1000 },
      );
      installed &&= result.code === 0;
    }
    if (installed) {
      for (const project of tsProjects) {
        report.original[project.dir] = await typecheck(origDir, project);
      }
    }
    fs.rmSync(origDir, { recursive: true, force: true });
  }

  // 2. Install the 2.0 packages.
  if (!args.skipInstall && tsProjects.length > 0) {
    const roots = installRoots;
    walk(appDir, (rel) => {
      if (path.basename(rel) === "package.json")
        report._pkgFiles = [...(report._pkgFiles ?? []), rel];
    });
    for (const rel of report._pkgFiles ?? []) {
      await resolveWorkspaceDeps(path.join(appDir, rel), args, index, tarballs);
    }
    delete report._pkgFiles;
    for (const project of projects) {
      pointAtTarballs(
        path.join(appDir, project.dir, "package.json"),
        tarballs,
        {
          isInstallRoot: roots.has(project.dir),
        },
      );
    }
    report.steps.install = [];
    for (const root of roots) {
      const rootPkg = path.join(appDir, root, "package.json");
      if (!projects.some((p) => p.dir === root) && fs.existsSync(rootPkg)) {
        pointAtTarballs(rootPkg, tarballs, { isInstallRoot: true });
      }
      for (const lock of [
        "package-lock.json",
        "yarn.lock",
        "bun.lockb",
        "bun.lock",
      ]) {
        fs.rmSync(path.join(appDir, root, lock), { force: true });
      }
      const result = await run(
        "pnpm",
        [
          "install",
          "--no-frozen-lockfile",
          "--ignore-scripts",
          "--prefer-offline",
          "--reporter=silent",
        ],
        { cwd: path.join(appDir, root), timeout: 15 * 60 * 1000 },
      );
      report.steps.install.push({
        root,
        ok: result.code === 0,
        output:
          result.code === 0 ? "" : (result.stdout + result.stderr).slice(-3000),
      });
    }
    await git(appDir, "add", "-A");
    await git(appDir, "commit", "-qm", "2.0 packages", "--no-verify");
  }

  // 3. Type-check before the codemod.
  report.before = {};
  for (const project of tsProjects) {
    report.before[project.dir] = await typecheck(appDir, project);
  }

  // 4. The codemod, then a second run that must change nothing.
  report.steps.codemod = await runCodemod(appDir);
  const diffStat = await git(appDir, "diff", "--stat");
  report.steps.codemod.diffStat =
    diffStat.stdout.trim().split("\n").pop() ?? "";
  const diff = await git(appDir, "diff");
  fs.writeFileSync(path.join(workDir, "codemod.diff"), diff.stdout);
  await git(appDir, "add", "-A");
  await git(appDir, "commit", "-qm", "codemod", "--no-verify");

  const second = await runCodemod(appDir);
  const secondDiff = await git(appDir, "diff");
  report.steps.idempotent = {
    ok: second.ok && secondDiff.stdout.trim() === "",
    diff: secondDiff.stdout.slice(0, 6000),
  };
  if (secondDiff.stdout.trim()) await git(appDir, "checkout", "--", ".");

  // 5. Type-check after, and classify each error.
  report.after = {};
  report.todos = 0;
  walk(appDir, (rel) => {
    if (!/\.(tsx?|jsx?|mjs|cjs|mts|cts)$/.test(rel)) return;
    const text = fs.readFileSync(path.join(appDir, rel), "utf8");
    report.todos += text.split(TODO).length - 1;
  });
  for (const project of tsProjects) {
    const after = await typecheck(appDir, project);
    const beforeKeys = new Set(
      report.before[project.dir].errors.map(
        (e) => `${e.file}|${e.code}|${e.message}`,
      ),
    );
    const originalKeys = new Set(
      (report.original[project.dir]?.errors ?? []).map(
        (e) => `${e.file}|${e.code}|${e.message}`,
      ),
    );
    for (const error of after.errors) {
      error.kind = classify(appDir, error, beforeKeys, originalKeys);
    }
    report.after[project.dir] = after;
  }

  // 5b. The skill's dependency step, then the type check again: what an app
  // looks like once its package.json is updated.
  const missing = missingPackages(report.after);
  report.addedDependencies = Object.fromEntries(
    [...missing].map(([dir, pkgs]) => [dir, [...pkgs]]),
  );
  // The skill also aligns @ag-ui/* with the version 2.0 uses, and forces one
  // copy of it, so agent integrations share one AbstractAgent.
  const AG_UI = ["@ag-ui/client", "@ag-ui/core", "@ag-ui/encoder"];
  const usesAgUi = tsProjects.some((project) => {
    const pkg = readJson(path.join(appDir, project.dir, "package.json"));
    return DEP_FIELDS.some((field) => AG_UI.some((name) => pkg[field]?.[name]));
  });
  if ((missing.size > 0 || usesAgUi) && !args.skipInstall) {
    const roots = new Set();
    for (const [dir, pkgs] of missing) {
      const file = path.join(appDir, dir, "package.json");
      const pkg = readJson(file);
      pkg.dependencies = { ...pkg.dependencies };
      for (const name of pkgs)
        pkg.dependencies[name] = COMPANION_VERSIONS[name];
      writeJson(file, pkg);
      roots.add(installRootFor(appDir, dir));
    }
    for (const project of tsProjects) {
      const file = path.join(appDir, project.dir, "package.json");
      const pkg = readJson(file);
      for (const field of DEP_FIELDS) {
        if (field === "peerDependencies") continue;
        for (const name of AG_UI) {
          if (pkg[field]?.[name]) pkg[field][name] = COMPANION_VERSIONS[name];
        }
      }
      writeJson(file, pkg);
      roots.add(installRootFor(appDir, project.dir));
    }
    for (const root of roots) {
      const file = path.join(appDir, root, "package.json");
      if (!fs.existsSync(file)) continue;
      const pkg = readJson(file);
      pkg.pnpm = {
        ...pkg.pnpm,
        overrides: {
          ...pkg.pnpm?.overrides,
          ...Object.fromEntries(
            AG_UI.map((name) => [name, COMPANION_VERSIONS[name]]),
          ),
          ...zodOverrides(tarballs),
        },
      };
      writeJson(file, pkg);
    }
    for (const root of roots) {
      await run(
        "pnpm",
        [
          "install",
          "--no-frozen-lockfile",
          "--ignore-scripts",
          "--prefer-offline",
          "--reporter=silent",
        ],
        { cwd: path.join(appDir, root), timeout: 15 * 60 * 1000 },
      );
    }
    report.afterDeps = {};
    for (const project of tsProjects) {
      const result = await typecheck(appDir, project);
      const beforeKeys = new Set(
        report.before[project.dir].errors.map(
          (e) => `${e.file}|${e.code}|${e.message}`,
        ),
      );
      const originalKeys = new Set(
        (report.original[project.dir]?.errors ?? []).map(
          (e) => `${e.file}|${e.code}|${e.message}`,
        ),
      );
      for (const error of result.errors) {
        error.kind = classify(appDir, error, beforeKeys, originalKeys);
      }
      report.afterDeps[project.dir] = result;
    }
  } else {
    report.afterDeps = report.after;
  }

  // 6. v1 imports left in the code.
  report.leftovers = scanLeftovers(appDir);
  return report;
}

// ---------------------------------------------------------------------------
// Summary

function summarize(reports) {
  const kinds = [
    "unexplained",
    "copilotkit-import",
    "unchanged",
    "missing-dep",
    "todo",
    "pre-existing",
    "app",
  ];
  const rows = [];
  const totals = Object.fromEntries(kinds.map((k) => [k, 0]));
  for (const r of reports) {
    const before = Object.values(r.before ?? {}).reduce(
      (n, t) => n + t.errors.length,
      0,
    );
    const afterErrors = Object.values(r.afterDeps ?? r.after ?? {}).flatMap(
      (t) => t.errors,
    );
    const counts = Object.fromEntries(kinds.map((k) => [k, 0]));
    for (const e of afterErrors) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    for (const k of kinds) totals[k] += counts[k];
    const installFailed = (r.steps.install ?? []).some((s) => !s.ok);
    rows.push({
      example: r.example,
      projects: (r.projects ?? []).filter((p) => p.hasTsconfig).length,
      install: r.steps.install ? (installFailed ? "FAIL" : "ok") : "-",
      codemod: r.steps.codemod ? (r.steps.codemod.ok ? "ok" : "FAIL") : "-",
      idempotent: r.steps.idempotent
        ? r.steps.idempotent.ok
          ? "ok"
          : "NO"
        : "-",
      changed: r.steps.codemod?.diffStat ?? "",
      todos: r.todos ?? 0,
      original:
        r.original && Object.keys(r.original).length
          ? Object.values(r.original).reduce((n, t) => n + t.errors.length, 0)
          : "-",
      before,
      after: afterErrors.length,
      ...counts,
      leftovers: (r.leftovers ?? []).filter((h) => !h.flagged).length,
    });
  }
  const header = [
    "example",
    "projects",
    "install",
    "codemod",
    "idempotent",
    "todos",
    "original",
    "before",
    "after",
    ...kinds,
    "leftovers",
  ];
  const lines = [
    "| " + header.join(" | ") + " |",
    "| " + header.map(() => "---").join(" | ") + " |",
    ...rows.map((row) => "| " + header.map((h) => row[h]).join(" | ") + " |"),
  ];
  return { rows, totals, markdown: lines.join("\n") };
}

// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(codemodBin)) {
    throw new Error(`No codemod CLI at ${codemodBin}: run pnpm install first.`);
  }
  const tarballs = tarballMap(args.tarballs);
  if (Object.keys(tarballs).length === 0) {
    throw new Error(`No @copilotkit tarballs in ${args.tarballs}`);
  }
  fs.mkdirSync(path.join(args.out, "reports"), { recursive: true });
  let examples = await listExamples(args.ref);
  if (args.only.length) {
    examples = examples.filter((e) => args.only.some((o) => e.includes(o)));
  }
  console.log(
    `${examples.length} examples from ${args.ref}, concurrency ${args.concurrency}`,
  );
  const index = await packageIndex(args.ref);

  const reports = [];
  const queue = [...examples];
  const workers = Array.from(
    { length: Math.min(args.concurrency, os.cpus().length) },
    async () => {
      while (queue.length) {
        const example = queue.shift();
        const started = Date.now();
        let report;
        try {
          report = await runExample(example, args, tarballs, index);
        } catch (error) {
          report = {
            example,
            steps: {
              harness: { ok: false, output: String(error?.stack ?? error) },
            },
          };
        }
        report.ms = Date.now() - started;
        reports.push(report);
        writeJson(
          path.join(
            args.out,
            "reports",
            `${example.replace(/\//g, "__")}.json`,
          ),
          report,
        );
        const after = Object.values(report.after ?? {}).flatMap(
          (t) => t.errors,
        );
        const unexplained = after.filter(
          (e) => e.kind === "unexplained" || e.kind === "copilotkit-import",
        ).length;
        console.log(
          `[${reports.length}/${examples.length}] ${example}  ${Math.round(report.ms / 1000)}s  after=${after.length} unexplained=${unexplained}`,
        );
      }
    },
  );
  await Promise.all(workers);

  reports.sort((a, b) => a.example.localeCompare(b.example));
  const summary = summarize(reports);
  writeJson(path.join(args.out, "summary.json"), {
    totals: summary.totals,
    rows: summary.rows,
  });
  fs.writeFileSync(path.join(args.out, "summary.md"), summary.markdown + "\n");
  console.log("\n" + JSON.stringify(summary.totals));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

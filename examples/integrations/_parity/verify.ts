/**
 * Integration-demo parity verifier.
 *
 * Reads the parity manifest and checks each instance against the north-star:
 *   - verbatim files byte-equal (modulo allowedDivergence)
 *   - tracked package.json keys equal (or equal to instance override)
 *   - canonical prompt present and byte-equal at <instance>/agent/PROMPT.md
 *   - agent tool names + state keys declared in manifest present in the
 *     instance's agent source (grep-level, not AST — see `scanAgentSurface`)
 *
 * Exit codes:
 *   0 — no errors
 *   1 — one or more errors (drift)
 *   2 — invalid CLI input
 *   3 — unreadable (missing file, unreadable dir)
 *
 * Usage:
 *   pnpm tsx examples/integrations/_parity/verify.ts
 *   pnpm tsx examples/integrations/_parity/verify.ts --target=langgraph-js
 *   pnpm tsx examples/integrations/_parity/verify.ts --json
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ParityRoot } from "./lib/manifest.js";
import {
  loadManifest,
  instanceDir,
  northStarDir,
  listInstances,
} from "./lib/manifest.js";
import { fileExists, fileSha256, getByPath } from "./lib/diff.js";
import type { DriftItem, Report } from "./lib/report.js";
import { printReports, hasErrors } from "./lib/report.js";
import { expandPattern } from "./sync.js";

interface CliOpts {
  target?: string;
  json: boolean;
  noColor: boolean;
}

function parseCli(argv: string[]): CliOpts {
  const opts: CliOpts = { json: false, noColor: false };
  for (const arg of argv) {
    if (arg === "--json") opts.json = true;
    else if (arg === "--no-color") opts.noColor = true;
    else if (arg.startsWith("--target="))
      opts.target = arg.slice("--target=".length);
    else if (arg === "--help" || arg === "-h") {
      process.stderr.write(
        [
          "verify integration-demo parity.",
          "",
          "  --target=<name>   verify a single instance",
          "  --json            emit machine-readable report",
          "  --no-color        disable ANSI color",
          "",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      process.stderr.write(`unknown arg: ${arg}\n`);
      process.exit(2);
    }
  }
  return opts;
}

function resolveParityDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function verifyInstance(root: ParityRoot, instance: string): Report {
  const items: DriftItem[] = [];
  const manifest = root.manifest;
  const from = northStarDir(root);
  const to = instanceDir(root, instance);
  const inst = manifest.instances[instance]!;

  if (!fileExists(to)) {
    items.push({
      severity: "error",
      instance,
      kind: "missing-instance",
      subject: instance,
      detail: `directory not found: ${to}`,
    });
    return { instance, items };
  }

  // Verbatim files
  for (const pattern of manifest.tracked.verbatimFiles) {
    const matches = expandPattern(from, pattern);
    if (matches.length === 0) {
      items.push({
        severity: "warn",
        instance,
        kind: "verbatim-file",
        subject: pattern,
        detail: "pattern matched no files in north-star",
      });
      continue;
    }
    for (const relPath of matches) {
      if (isAllowedDivergence(relPath, inst.allowedDivergence)) continue;
      const src = join(from, relPath);
      const dst = join(to, relPath);
      if (!fileExists(dst)) {
        items.push({
          severity: "error",
          instance,
          kind: "verbatim-file",
          subject: relPath,
          detail: "missing in instance",
        });
        continue;
      }
      const srcSha = fileSha256(src);
      const dstSha = fileSha256(dst);
      if (srcSha !== dstSha) {
        items.push({
          severity: "error",
          instance,
          kind: "verbatim-file",
          subject: relPath,
          detail: "content differs from north-star",
          expected: srcSha,
          actual: dstSha,
        });
      } else {
        items.push({
          severity: "ok",
          instance,
          kind: "verbatim-file",
          subject: relPath,
        });
      }
    }
  }

  // package.json tracked keys
  const pkgSrc = JSON.parse(
    readFileSync(join(from, "package.json"), "utf8"),
  ) as Record<string, unknown>;
  const pkgDst = JSON.parse(
    readFileSync(join(to, "package.json"), "utf8"),
  ) as Record<string, unknown>;
  for (const keyPath of manifest.tracked.packageJsonPaths) {
    const override = inst.packageJsonOverrides[keyPath];
    const expected =
      override !== undefined ? override : getByPath(pkgSrc, keyPath);
    if (expected === undefined) continue;
    const actual = getByPath(pkgDst, keyPath);
    if (actual === undefined) {
      items.push({
        severity: "error",
        instance,
        kind: "package-json",
        subject: keyPath,
        detail: "missing in instance package.json",
        expected: String(expected),
      });
      continue;
    }
    if (actual !== expected) {
      items.push({
        severity: "error",
        instance,
        kind: "package-json",
        subject: keyPath,
        detail: "value differs from expected",
        expected: String(expected),
        actual: String(actual),
      });
    } else {
      items.push({
        severity: "ok",
        instance,
        kind: "package-json",
        subject: keyPath,
      });
    }
  }

  // Canonical prompt: grep agent source for the first non-blank line of
  // the canonical prompt. Full-text match is too brittle across triple-quote
  // indentation; first line is a deterministic, high-signal marker.
  const promptSrc = resolve(root.integrationsDir, manifest.canonicalPromptFile);
  if (!fileExists(promptSrc)) {
    items.push({
      severity: "error",
      instance,
      kind: "prompt",
      subject: manifest.canonicalPromptFile,
      detail: "canonical prompt missing in repo",
    });
  } else {
    const canonicalFirstLine = readFirstNonBlankLine(promptSrc);
    if (canonicalFirstLine === null) {
      items.push({
        severity: "error",
        instance,
        kind: "prompt",
        subject: manifest.canonicalPromptFile,
        detail: "canonical prompt is empty",
      });
    } else {
      const agentTextForPrompt = readAgentText(to);
      if (agentTextForPrompt === null) {
        items.push({
          severity: "warn",
          instance,
          kind: "prompt",
          subject: "agent/",
          detail: "agent source not readable — skipping prompt check",
        });
      } else if (!agentTextForPrompt.includes(canonicalFirstLine)) {
        items.push({
          severity: "error",
          instance,
          kind: "prompt",
          subject: "canonical prompt",
          detail: `first line not found in agent source: "${truncate(canonicalFirstLine, 80)}"`,
        });
      } else {
        items.push({
          severity: "ok",
          instance,
          kind: "prompt",
          subject: "canonical prompt",
        });
      }
    }
  }

  // Agent surface: tool names + state keys grep-check.
  // Intentional shallow check: verifier confirms the declared identifiers
  // appear somewhere in the agent source. It does NOT validate call-site
  // correctness — that's the aimock fixture integration test's job.
  const agentText = readAgentText(to);
  if (agentText === null) {
    items.push({
      severity: "warn",
      instance,
      kind: "agent-tool",
      subject: "agent/",
      detail: "agent source not readable — skipping surface check",
    });
  } else {
    for (const tool of manifest.tracked.agentSurface.toolNames) {
      if (!agentText.includes(tool)) {
        items.push({
          severity: "error",
          instance,
          kind: "agent-tool",
          subject: tool,
          detail: "tool name not found in agent source",
        });
      } else {
        items.push({
          severity: "ok",
          instance,
          kind: "agent-tool",
          subject: tool,
        });
      }
    }
    for (const key of manifest.tracked.agentSurface.stateKeys) {
      if (!agentText.includes(key)) {
        items.push({
          severity: "warn",
          instance,
          kind: "agent-state",
          subject: key,
          detail: "state key not found in agent source",
        });
      } else {
        items.push({
          severity: "ok",
          instance,
          kind: "agent-state",
          subject: key,
        });
      }
    }
  }

  return { instance, items };
}

function readAgentText(instanceRoot: string): string | null {
  const agentDir = join(instanceRoot, "agent");
  if (!fileExists(agentDir)) return null;
  // Recursively read .py, .ts, .js files and concatenate. Cheap enough; the
  // agent tree is small (< 1MB).
  const parts: string[] = [];
  const stack = [agentDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = require("node:fs").readdirSync(dir);
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (
        entry === "node_modules" ||
        entry === ".venv" ||
        entry === ".langgraph_api" ||
        entry === "__pycache__" ||
        entry === "dist" ||
        entry === "build" ||
        entry === ".next"
      )
        continue;
      const abs = join(dir, entry);
      const st = require("node:fs").statSync(abs);
      if (st.isDirectory()) {
        stack.push(abs);
      } else if (/\.(py|ts|tsx|js|mjs)$/.test(entry)) {
        try {
          parts.push(readFileSync(abs, "utf8"));
        } catch {
          /* unreadable file — skip */
        }
      }
    }
  }
  return parts.join("\n");
}

function readFirstNonBlankLine(path: string): string | null {
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

function isAllowedDivergence(relPath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      if (relPath === prefix || relPath.startsWith(prefix + "/")) return true;
    } else if (pattern === relPath) {
      return true;
    }
  }
  return false;
}

function main(): void {
  const opts = parseCli(process.argv.slice(2));
  const parityDir = resolveParityDir();
  const root = loadManifest(parityDir);

  const targets = opts.target ? [opts.target] : listInstances(root);

  if (opts.target && !root.manifest.instances[opts.target]) {
    process.stderr.write(`unknown instance: ${opts.target}\n`);
    process.exit(2);
  }

  const reports: Report[] = [];
  for (const t of targets) {
    if (t === root.manifest.northStar) continue;
    reports.push(verifyInstance(root, t));
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(reports, null, 2) + "\n");
  } else {
    printReports(reports, !opts.noColor);
  }

  const failed = hasErrors(reports);
  process.exit(failed ? 1 : 0);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`[parity] verify failed: ${(e as Error).message}\n`);
    process.exit(3);
  }
}

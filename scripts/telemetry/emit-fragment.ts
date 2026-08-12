// Emit a CopilotKit telemetry-registry fragment for one surface.
//
//   pnpm tsx scripts/telemetry/emit-fragment.ts --surface runtime|docs --out <path>
//
// Writes a fragment that validates against oss-path-to-production's
// telemetry-registry/schema/fragment.schema.json. CONTENT-GATED: if --out
// already holds a fragment whose `events` match what we just extracted, the
// file is left byte-for-byte untouched (released_in/generated_at preserved) and
// nothing is written — so the CI job opens a PR only when the event set, its
// properties, or its call sites actually change, never once per release.
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildRuntimeEvents,
  extractCallees,
  readRuntimeCatalog,
} from "./extract";
import type { FragmentEvent } from "./extract";

interface Fragment {
  repo: string;
  surface: string;
  released_in: string;
  generated_at: string;
  events: FragmentEvent[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const REPO = "CopilotKit";
const REPO_ROOT = path.resolve(
  arg("repo-root") ?? path.join(__dirname, "..", ".."),
);

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  const skipDir = new Set([
    "node_modules",
    "dist",
    ".next",
    ".turbo",
    ".nx",
    "__tests__",
  ]);
  const rec = (d: string): void => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (!skipDir.has(ent.name)) rec(p);
      } else if (
        exts.some((e) => ent.name.endsWith(e)) &&
        !/\.(test|spec)\.[tj]sx?$/.test(ent.name)
      ) {
        out.push(p);
      }
    }
  };
  rec(dir);
  return out.sort();
}

// Read files as { path: <repo-relative>, content } so call_sites are portable.
function load(absPaths: string[]): Array<{ path: string; content: string }> {
  return absPaths.map((p) => ({
    path: path.relative(REPO_ROOT, p),
    content: fs.readFileSync(p, "utf8"),
  }));
}

function shortSha(): string {
  const env = process.env.GITHUB_SHA;
  if (env) return env.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: REPO_ROOT,
    })
      .toString()
      .trim();
  } catch {
    return "local";
  }
}

function runtimeFragment(): {
  surface: string;
  released_in: string;
  events: FragmentEvent[];
} {
  const v1Rel = "packages/shared/src/telemetry/events.ts";
  const v2Rel = "packages/runtime/src/v2/runtime/telemetry/events.ts";
  const read = (rel: string) => ({
    path: rel,
    content: fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"),
  });
  const catalog = readRuntimeCatalog(read(v1Rel), read(v2Rel));
  const callSiteFiles = load(
    walk(path.join(REPO_ROOT, "packages/runtime/src"), [".ts"]),
  );
  const events = buildRuntimeEvents(catalog, callSiteFiles);
  const version = JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "packages/runtime/package.json"),
      "utf8",
    ),
  ).version;
  return { surface: "runtime", released_in: `runtime@${version}`, events };
}

function docsFragment(): {
  surface: string;
  released_in: string;
  events: FragmentEvent[];
} {
  const srcDir = path.join(REPO_ROOT, "showcase/shell-docs/src");
  const files = load(walk(srcDir, [".ts", ".tsx"]));
  const events = extractCallees(files, {
    calleeNames: ["posthog.capture", "capture"],
    callSites: "file",
  })
    // Drop PostHog-reserved events ($pageview et al.) — those are analytics
    // infrastructure, not product/GTM events the registry catalogs.
    .filter((e) => !e.event.startsWith("$"));
  return { surface: "docs", released_in: `shell-docs@${shortSha()}`, events };
}

function main(): void {
  const surface = arg("surface");
  const out = arg("out");
  if (!surface || !out) {
    console.error(
      "usage: emit-fragment.ts --surface runtime|docs --out <path> [--released-in X] [--generated-at ISO]",
    );
    process.exit(2);
  }

  const built =
    surface === "runtime"
      ? runtimeFragment()
      : surface === "docs"
        ? docsFragment()
        : undefined;
  if (!built) {
    console.error(`unknown surface: ${surface} (expected runtime|docs)`);
    process.exit(2);
  }
  if (built.events.length === 0) {
    // A surface with zero events is almost always a broken extraction, not a
    // real state — fail loud rather than emit an empty fragment.
    console.error(
      `::error::extracted 0 events for surface ${surface}; refusing to write an empty fragment`,
    );
    process.exit(1);
  }

  const fragment: Fragment = {
    repo: REPO,
    surface: built.surface,
    released_in: arg("released-in") ?? built.released_in,
    generated_at: arg("generated-at") ?? new Date().toISOString(),
    events: built.events,
  };

  const eventsJson = JSON.stringify(fragment.events);
  if (fs.existsSync(out)) {
    const existing = JSON.parse(fs.readFileSync(out, "utf8")) as Fragment;
    if (JSON.stringify(existing.events) === eventsJson) {
      console.log(
        `${surface}: ${fragment.events.length} events unchanged — leaving ${out} untouched`,
      );
      return;
    }
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(fragment, null, 2) + "\n");
  console.log(
    `${surface}: wrote ${fragment.events.length} events → ${out} (released_in ${fragment.released_in})`,
  );
}

if (require.main === module) main();

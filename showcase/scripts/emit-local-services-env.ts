#!/usr/bin/env npx tsx
/**
 * emit-local-services-env.ts — Bridge the `demo_frontend` manifest field into
 * the one form `docker-compose.local.yml` can consume: environment variables.
 *
 * WHY A GENERATED BRIDGE EXISTS AT ALL. `demo_frontend` in each
 * `showcase/integrations/<slug>/manifest.yaml` is the single tracked source of
 * truth for "the unified frontend serves this slug's demos". Compose is YAML: it
 * cannot read a manifest, and the roster it builds
 * (`LOCAL_SERVICES_JSON`, see `docker-compose.local.yml`) can only interpolate
 * `${LOCAL_SERVICE_URL_<SLUG>}`. So the migration state has to be projected into
 * that namespace by something, and the choice is between an operator
 * hand-setting the var (the state this file replaces — two hand-set knobs,
 * nothing comparing them) and a generated artifact.
 *
 * This follows `emit-railway-envs-json.ts`, which solves the identical problem
 * for Railway: a TypeScript SSOT, a tracked generated artifact, an idempotent
 * write, and a `--check` mode CI runs to fail on a stale artifact. Same flags,
 * same exit contract.
 *
 * WHY IT DOES NOT WRITE `showcase/.env`. That file is HAND-MAINTAINED and
 * gitignored (`*.env` in the repo-root `.gitignore`); it holds an operator's
 * provider keys. Generating into it would either clobber those keys or require
 * surgical in-place editing of a file no test can see. The generated artifact is
 * separate and tracked, and `showcase/scripts/cli/_common.sh` exports its
 * contents into the environment before invoking compose — shell environment
 * outranks a `.env` file in compose interpolation, so the manifest wins. The
 * same file additionally ABORTS when `showcase/.env` sets a
 * `LOCAL_SERVICE_URL_<SLUG>` that CONTRADICTS the manifest, rather than silently
 * overriding a line the operator can still see (see
 * `assert_unified_frontend_sources_agree` there).
 *
 * Consumers:
 *   - showcase/scripts/cli/_common.sh — exports every assignment before compose
 *     runs (both the persistent stack and `apply_isolation`).
 *   - showcase/harness/src/cli/unified-frontend-sources.test.ts — cross-checks
 *     this artifact against the harness's own manifest-derived view, so a
 *     stale artifact cannot make the two namespaces disagree quietly.
 *
 * WHAT IT EMITS. One `LOCAL_SERVICE_URL_<SLUG>=<container URL>` line per slug
 * whose manifest declares `demo_frontend: unified`, and NOTHING for a slug on
 * `integration` — the compose roster's own `:-http://<slug>:10000` default is
 * already the un-migrated value, so emitting it would duplicate a default in a
 * second place. With no slug migrated the artifact is a header and no
 * assignments, which is exactly the tracked state today.
 *
 * Flags:
 *   --check      Exit 1 if the on-disk artifact differs from what the manifests
 *                imply (do not write). Exit 2 if the read fails for any reason
 *                other than the file being absent — fail loud rather than
 *                report a real error as drift. Same contract as
 *                emit-railway-envs-json.ts.
 *   --out=<path> Override the output path (used by tests for hermetic writes).
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  composePublicUrlFor,
  demoFrontendOf,
  parseManifest,
} from "./lib/manifest";
import type { DemoFrontend } from "./lib/manifest";

// `fileURLToPath`, NOT `new URL(".", import.meta.url).pathname`. The latter
// yields "/F:/…" on Windows, which `resolve` then re-anchors to "F:\F:\…" —
// the emitter aborted with ENOENT on the integrations directory.
const SHOWCASE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INTEGRATIONS_DIR = join(SHOWCASE_DIR, "integrations");
const DEFAULT_OUTPUT_PATH = join(SHOWCASE_DIR, "local-services.generated.env");

/** Env-var name for a slug, matching the compose file and `_common.sh`. */
export function localServiceUrlKey(slug: string): string {
  return `LOCAL_SERVICE_URL_${slug.toUpperCase().replace(/-/g, "_")}`;
}

export interface SlugFrontend {
  slug: string;
  frontend: DemoFrontend;
}

/**
 * Read every integration manifest and return its slug + resolved
 * `demo_frontend`, sorted by slug so the artifact is deterministic.
 *
 * A manifest that fails to parse is a HARD ERROR, not a skip. The whole point
 * of this emitter is that the artifact is a faithful projection of the
 * manifests; quietly dropping an unparseable one would emit an artifact that
 * says a slug is un-migrated when nobody actually knows.
 */
export function readSlugFrontends(integrationsDir: string): SlugFrontend[] {
  const out: SlugFrontend[] = [];
  for (const entry of readdirSync(integrationsDir, { withFileTypes: true })) {
    // `_shared` is a support directory, not an integration; it carries no
    // manifest. Anything else without a manifest is skipped the same way.
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const manifestPath = join(integrationsDir, entry.name, "manifest.yaml");
    const parsed = parseManifest(manifestPath, entry.name);
    if (parsed.kind === "missing") continue;
    if (parsed.kind !== "ok") {
      throw new Error(
        `emit-local-services-env: cannot derive demo_frontend for "${entry.name}": ` +
          `${manifestPath} is ${parsed.kind}` +
          ("error" in parsed ? ` — ${parsed.error}` : ""),
      );
    }
    out.push({
      slug: parsed.manifest.slug,
      frontend: demoFrontendOf(parsed.manifest),
    });
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

export function renderEnvFile(entries: readonly SlugFrontend[]): string {
  const migrated = entries.filter((e) => e.frontend === "unified");
  const lines = [
    // ASCII only, deliberately. `showcase/scripts/cli/_common.sh` parses this
    // file with sed/read to export the assignments; keeping it 7-bit avoids any
    // locale-dependent surprise there.
    "# GENERATED FILE - DO NOT EDIT.",
    "#",
    "# Projection of the `demo_frontend` field in every",
    "# showcase/integrations/<slug>/manifest.yaml into the LOCAL_SERVICE_URL_<SLUG>",
    "# namespace that docker-compose.local.yml's LOCAL_SERVICES_JSON roster can",
    "# interpolate. Compose cannot read a manifest; this is the bridge.",
    "#",
    "# To migrate a slug onto the unified frontend, set",
    "#   demo_frontend: unified",
    "# in its manifest.yaml and re-run:",
    "#   npx tsx showcase/scripts/emit-local-services-env.ts",
    "#",
    "# Only MIGRATED slugs appear below. An un-migrated slug is deliberately",
    "# absent: the compose roster already defaults to http://<slug>:10000, and",
    "# restating that default here would put it in two places.",
    "",
  ];
  if (migrated.length === 0) {
    lines.push("# No slug is migrated. Nothing to export.");
  } else {
    for (const { slug, frontend } of migrated) {
      lines.push(
        `${localServiceUrlKey(slug)}=${composePublicUrlFor(slug, frontend)}`,
      );
    }
  }
  return lines.join("\n") + "\n";
}

function parseOutPath(args: string[]): string {
  const flag = args.find((a) => a.startsWith("--out="));
  if (flag) return resolve(flag.slice("--out=".length));
  return DEFAULT_OUTPUT_PATH;
}

function main(): void {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const outputPath = parseOutPath(args);
  const next = renderEnvFile(readSlugFrontends(INTEGRATIONS_DIR));

  if (check) {
    let current = "";
    try {
      current = readFileSync(outputPath, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        // A non-ENOENT read failure (EACCES, EISDIR) is a real error, not
        // drift. Same reasoning as emit-railway-envs-json.ts.
        process.stderr.write(
          `emit-local-services-env: failed to read ${outputPath}: ${
            (err as Error).message
          }\n`,
        );
        process.exit(2);
      }
    }
    if (current !== next) {
      process.stderr.write(
        `${outputPath} is stale — it disagrees with the demo_frontend fields in ` +
          `showcase/integrations/*/manifest.yaml. Re-run:\n` +
          `  npx tsx showcase/scripts/emit-local-services-env.ts\n`,
      );
      process.exit(1);
    }
    process.stdout.write("local-services.generated.env is up to date.\n");
    return;
  }

  writeFileSync(outputPath, next);
  process.stdout.write(`wrote ${outputPath}\n`);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("emit-local-services-env.ts");
if (isMain) main();

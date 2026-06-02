/**
 * Drift guard — the `probe_runs` PocketBase migration schema vs the
 * PocketBase v0.22 `required`-validation semantics that actually gate writes.
 *
 * THE INVARIANT THIS PROTECTS (the D6 result-persistence outage this fixes):
 *
 *   PocketBase validates a `required:true` field with
 *   `validation.Required.Validate(value)` (ozzo-validation), which treats a
 *   field's ZERO VALUE as "empty". For a `bool` field the zero value is
 *   `false`, so a `required:true` bool REJECTS every write that sends
 *   `false` with `{"<field>":{"code":"validation_required","message":
 *   "Missing required value."}}` — a 400.
 *
 *   The `probe_runs.triggered` column is `false` for every SCHEDULED run (the
 *   common case — only ad-hoc Slack/webhook runs are `true`). When `triggered`
 *   was marked `required:true`, every scheduled probe's `probe_runs` insert
 *   400'd at `runWriter.start()` (logged as `probe.run-writer-start-failed` /
 *   `probe.run-row-orphan-risk`), so NO run/result rows persisted — the
 *   dashboard never saw d6-all-pills-e2e (LGP) results.
 *
 *   The writer (run-history.ts `start()`) ALWAYS sends an explicit boolean,
 *   so `required:true` buys no integrity — a bool is never genuinely absent —
 *   while actively breaking the `false` path. The correct schema is
 *   `required:false` for the `triggered` bool.
 *
 * This guard derives the field's `required` flag directly from the migration
 * source (same fs-parse approach as state-enum-drift.test.ts — the migration
 * is PocketBase-JSVM JS that can't be imported here) so it FAILS if anyone
 * re-tightens a bool field to `required:true` and silently resurrects the
 * scheduled-run write outage.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve(__dirname, "../../../pocketbase/pb_migrations");
const PROBE_RUNS_MIGRATION = resolve(
  MIGRATIONS_DIR,
  "1777165230_create_probe_runs.js",
);

/**
 * Returns `true`/`false`/`null` for the `required:` flag of the field object
 * whose `name: "<fieldName>"` declaration appears in the migration source.
 * Anchors on `name:"<field>"`, then reads the first `required: <bool>` that
 * follows before the next `name:` (i.e. within the same field object).
 */
function fieldRequired(src: string, fieldName: string): boolean | null {
  const nameRe = new RegExp(`name:\\s*"${fieldName}"`);
  const m = nameRe.exec(src);
  if (!m) {
    throw new Error(
      `probe-runs-schema-drift parser: could not find name:"${fieldName}" ` +
        `in the probe_runs migration — update this parser if the field layout changed.`,
    );
  }
  // Slice from this field's `name:` up to the next field's `name:` (or EOF) so
  // we only read THIS field object's `required:` flag.
  const rest = src.slice(m.index + m[0].length);
  const nextName = rest.search(/name:\s*"/);
  const fieldBlock = nextName === -1 ? rest : rest.slice(0, nextName);
  const req = fieldBlock.match(/required:\s*(true|false)/);
  if (!req || req[1] === undefined) return null;
  return req[1] === "true";
}

// Strip `//` line comments so a `required:`-shaped phrase inside a code comment
// (the field's own doc block discusses the required-bool gotcha) can't be
// mis-parsed as the actual schema property.
function stripLineComments(src: string): string {
  return src
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

const src = stripLineComments(readFileSync(PROBE_RUNS_MIGRATION, "utf8"));

describe("probe-runs-schema-drift", () => {
  it("sanity: parser finds the triggered field in the probe_runs migration", () => {
    // Guards the parser itself — if this breaks, the assertion below is
    // meaningless.
    expect(src).toContain('name: "triggered"');
  });

  it("triggered bool field is NOT required:true (PB rejects false on required bool)", () => {
    // PocketBase v0.22 `validation.Required` rejects the zero value; for a
    // bool that is `false`, which is the value scheduled runs send. A
    // required:true triggered field 400s every scheduled probe's run insert.
    const required = fieldRequired(src, "triggered");
    expect(
      required,
      "probe_runs.triggered must be required:false — a required:true bool " +
        "rejects every `false` write (scheduled runs) with validation_required, " +
        "breaking probe_runs persistence",
    ).not.toBe(true);
  });
});

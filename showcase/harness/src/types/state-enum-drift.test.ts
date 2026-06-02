/**
 * Drift guard — TS `State`/`Transition` unions vs the PocketBase select-enum
 * values declared in the migrations.
 *
 * THE INVARIANT THIS PROTECTS (the D6 false-green killed by this PR):
 *
 *   The persisted `State` ("green"|"red"|"degraded"|"unknown") and
 *   `Transition` (…|"cleared") unions in `src/types/index.ts` MUST each be a
 *   SUBSET of the corresponding PocketBase `select` enum's `values`. PB
 *   `select` fields are CLOSED enums: a write carrying a value outside the
 *   enum 400s. The status-writer's success path fails-closed SILENTLY on a
 *   400 (logs `pb_schema_error`, swallows it) — so a green cell that should
 *   flip to (say) a newly-added state would instead never update and RETAIN
 *   its green forever. That is exactly the false-green this PR kills, and it
 *   can be silently resurrected by anyone who widens a TS union without also
 *   widening the migration enum.
 *
 * There was NO test guarding this. This one derives the EFFECTIVE PB enum
 * value-sets directly from the migration files — the base closed enums in
 * `1776789100_recreate_collections_v2.js` PLUS the append in
 * `1779989300_add_unknown_state_enum.js` — so it self-updates when the
 * migrations change, and FAILS if a `State`/`Transition` member is added
 * without a matching enum widening.
 *
 * The migration files are plain `migrate(...)` JS that depend on the
 * PocketBase JSVM globals (`Dao`, `Collection`, ...), so they cannot be
 * `import`ed/evaluated here. We parse the relevant `values:[...]` arrays out
 * of the source text instead (same fs-parse approach as
 * `probes/helpers/d5-mapping-drift.test.ts`, which parses the cross-package
 * dashboard source for the identical "lives outside the type system" reason).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { STATE_VALUES, TRANSITION_VALUES } from "./index.js";

const MIGRATIONS_DIR = resolve(__dirname, "../../../pocketbase/pb_migrations");
const BASE_MIGRATION = resolve(
  MIGRATIONS_DIR,
  "1776789100_recreate_collections_v2.js",
);
const APPEND_MIGRATION = resolve(
  MIGRATIONS_DIR,
  "1779989300_add_unknown_state_enum.js",
);

/**
 * Pull the `values: [ ... ]` string-literal array that immediately follows
 * the Nth `name: "<fieldName>"` declaration in the base migration source.
 * The base migration declares `status.state`, `status_history.state`, and
 * `status_history.transition` each as `{ name: "...", type: "select", ...,
 * options: { values: [...] } }`. We anchor on the `name:` then grab the next
 * `values:[...]` so we resolve the correct field's enum.
 */
function baseEnumValues(
  src: string,
  fieldName: string,
  occurrence: number,
): string[] {
  const nameRe = new RegExp(`name:\\s*"${fieldName}"`, "g");
  let m: RegExpExecArray | null;
  let seen = 0;
  let anchor = -1;
  while ((m = nameRe.exec(src)) !== null) {
    seen += 1;
    if (seen === occurrence) {
      anchor = m.index;
      break;
    }
  }
  if (anchor === -1) {
    throw new Error(
      `state-enum-drift parser: could not find occurrence ${occurrence} of ` +
        `name:"${fieldName}" in base migration — if the migration's field ` +
        `layout changed, update this parser.`,
    );
  }
  const after = src.slice(anchor);
  const valuesBlock = after.match(/values:\s*\[([\s\S]*?)\]/);
  if (!valuesBlock || valuesBlock[1] === undefined) {
    throw new Error(
      `state-enum-drift parser: could not find values:[...] after ` +
        `name:"${fieldName}" (occurrence ${occurrence}) in base migration.`,
    );
  }
  return Array.from(
    valuesBlock[1].matchAll(/"([^"]+)"/g),
    (x) => x[1] as string,
  );
}

/**
 * Pull the appended literals from the append migration. It calls
 * `appendEnumValue("<collection>", "<field>", "<value>")` once per added
 * value; we collect the values added for a given collection+field.
 */
function appendedValues(
  src: string,
  collection: string,
  field: string,
): string[] {
  const re = new RegExp(
    `appendEnumValue\\(\\s*"${collection}"\\s*,\\s*"${field}"\\s*,\\s*"([^"]+)"\\s*\\)`,
    "g",
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push(m[1] as string);
  }
  return out;
}

const baseSrc = readFileSync(BASE_MIGRATION, "utf8");
const appendSrc = readFileSync(APPEND_MIGRATION, "utf8");

// status.state is the 1st `name:"state"`, status_history.state is the 2nd.
const statusStateEnum = new Set([
  ...baseEnumValues(baseSrc, "state", 1),
  ...appendedValues(appendSrc, "status", "state"),
]);
const historyStateEnum = new Set([
  ...baseEnumValues(baseSrc, "state", 2),
  ...appendedValues(appendSrc, "status_history", "state"),
]);
const historyTransitionEnum = new Set([
  ...baseEnumValues(baseSrc, "transition", 1),
  ...appendedValues(appendSrc, "status_history", "transition"),
]);

// Cross-package: the dashboard redeclares `State` independently (outside this
// workspace, parsed via fs — same reason as d5-mapping-drift). If reaching it
// fails, that's a test failure, not a skip: lockstep is the point.
const DASHBOARD_LIVE_STATUS = resolve(
  __dirname,
  "../../../shell-dashboard/src/lib/live-status.ts",
);
function parseDashboardStateUnion(): string[] {
  const src = readFileSync(DASHBOARD_LIVE_STATUS, "utf8");
  const m = src.match(/export\s+type\s+State\s*=\s*([^;]+);/);
  if (!m || !m[1]) {
    throw new Error(
      "state-enum-drift parser: could not locate `export type State = ...` " +
        "in dashboard live-status.ts — update this parser if its shape changed.",
    );
  }
  return Array.from(m[1].matchAll(/"([^"]+)"/g), (x) => x[1] as string);
}

describe("state-enum-drift", () => {
  it("sanity: parsers extract the expected current enum value-sets", () => {
    // Guards the parser itself — if these break, the subset assertions below
    // are meaningless. Pinned to the current migration; update WITH the
    // migration when the enums legitimately change.
    expect([...statusStateEnum].sort()).toEqual(
      ["degraded", "green", "red", "unknown"].sort(),
    );
    expect([...historyStateEnum].sort()).toEqual(
      ["degraded", "green", "red", "unknown"].sort(),
    );
    expect([...historyTransitionEnum].sort()).toEqual(
      [
        "cleared",
        "error",
        "first",
        "green_to_red",
        "red_to_green",
        "sustained_green",
        "sustained_red",
      ].sort(),
    );
  });

  it("every TS State member exists in the status.state PB enum", () => {
    const missing = STATE_VALUES.filter((s) => !statusStateEnum.has(s));
    expect(missing, `State members missing from status.state enum`).toEqual([]);
  });

  it("every TS State member exists in the status_history.state PB enum", () => {
    const missing = STATE_VALUES.filter((s) => !historyStateEnum.has(s));
    expect(
      missing,
      `State members missing from status_history.state enum`,
    ).toEqual([]);
  });

  it("every TS Transition member exists in the status_history.transition PB enum", () => {
    const missing = TRANSITION_VALUES.filter(
      (t) => !historyTransitionEnum.has(t),
    );
    expect(
      missing,
      `Transition members missing from status_history.transition enum`,
    ).toEqual([]);
  });

  it("harness State member-set equals dashboard State member-set (cross-package lockstep)", () => {
    const harness = [...STATE_VALUES].sort();
    const dashboard = parseDashboardStateUnion().sort();
    expect(dashboard).toEqual(harness);
  });
});

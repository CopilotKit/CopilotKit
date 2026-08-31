import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createFleetQueueClient,
  leaseExpired,
  PB_DATE_SEP_RE,
  PoisonedBacklogCountError,
  MAX_RECLAIM_ATTEMPTS,
  RESULT_WRITE_MAX_ATTEMPTS,
  RESULT_WRITE_RETRY_DELAY_MS,
  PRUNE_TERMINAL_MAX_AGE_MS,
  PRUNE_ZOMBIE_MAX_AGE_MS,
} from "./queue-client.js";
import { createJobClaimClient, JobClaimEndpointError } from "./job-claim.js";
import type {
  JobClaimClient,
  ClaimResult,
  RenewResult,
  ReleaseResult,
  JobView,
  JobStatus,
} from "./job-claim.js";
import type { PbClient, ListOpts, ListResult } from "../storage/pb-client.js";
import type {
  EnqueueJobInput,
  ServiceJobPayload,
  ServiceJobResult,
  ReportJobInput,
} from "./contracts.js";
import { probeKeyFamily } from "./contracts.js";
import type { Logger } from "../types/index.js";

/**
 * Per-FILE SILENT logger. Deliberately NOT the shared `../logger.js` module
 * object: spying on the shared logger leaks the spy into every other test
 * file under fork-reuse when an assertion failure skips `mockRestore()` (the
 * repo's known spy-leak class). Each method is a `vi.fn()` so tests can
 * assert log emissions directly (or via `vi.spyOn`, which is now safe — the
 * spied object is file-local). `vi.restoreAllMocks()` in `afterEach` clears
 * call history between tests even when an assertion fails mid-test.
 */
const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

afterEach(() => {
  // Restore any vi.spyOn wrappers FIRST (even when an assertion failure
  // skipped an in-test mockRestore), then REBUILD the logger methods: under
  // vitest 3 a restored spy leaves a plain (non-mock) function behind, and a
  // shared mock would otherwise carry call history across tests. Fresh
  // vi.fn()s per test keep every emission assertion isolated.
  vi.restoreAllMocks();
  logger.debug = vi.fn();
  logger.info = vi.fn();
  logger.warn = vi.fn();
  logger.error = vi.fn();
});

/**
 * Pins the control-plane ↔ worker QUEUE layer (S3): FleetQueueClient layered
 * over S0's JobClaimClient + the PB client. The three load-bearing behaviors
 * are an enqueue→claimNext round-trip (payload survives the row), report mapping
 * a result onto the terminal JobStatus S0's releaseJob expects, and
 * sweepExpired re-queueing expired leases to pending and surfacing the neutral
 * `worker-reclaimed-pending` comm errors for them.
 */

function samplePayload(
  overrides: Partial<ServiceJobPayload> = {},
): ServiceJobPayload {
  const probeKey = overrides.probeKey ?? "d6:langgraph-python";
  // Keep driverKind CONSISTENT with the probeKey's family: the many fixtures
  // here that override probeKey to another family (d4:, e2e-demos:, fNN:)
  // used to inherit the d6 default driverKind ("e2e_d6"), so a future
  // cross-validation of payload coherence (probeKey family ↔ driverKind)
  // would mass-fail these tests. Derivation mirrors the real pairs: `d6` ↔
  // `e2e_d6`, `e2e-demos` ↔ `e2e_demos` — underscore the family and prefix
  // `e2e_` unless it already leads with it. Explicit overrides still win.
  const family = probeKeyFamily(probeKey).replace(/[^a-zA-Z0-9]+/g, "_");
  const driverKind = family.startsWith("e2e") ? family : `e2e_${family}`;
  return {
    probeKey,
    serviceSlug: "langgraph-python",
    driverKind,
    meta: {
      runId: "run-1",
      triggered: false,
      enqueuedAt: "2026-06-04T00:00:00.000Z",
    },
    ...overrides,
  };
}

function jobView(overrides: Partial<JobView> = {}): JobView {
  return {
    id: "j1",
    probe_key: "d6:langgraph-python",
    status: "pending",
    claimed_by: "",
    lease_expires_at: null,
    version: 0,
    ...overrides,
  };
}

/** A typed in-memory row the fake PB returns from list/getOne. */
interface JobRow extends JobView {
  payload: ServiceJobPayload;
  /** Result-flow columns (migration 1779989700) the report path writes. */
  result?: unknown;
  result_processed?: boolean;
  /** Run-metadata columns (migration 1779990200) enqueue denormalizes. */
  run_id?: string;
  family?: string;
  /** PB system column; seeded by prune tests (real PB stamps it on create). */
  created?: string;
  /** Durable per-job lifetime reclaim tally (migration 1779990200) the
   * fleet-claim CAS bumps on every expired-lease steal AND sweeper re-queue.
   * Dashboard diagnostic only — NOT the cap signal. */
  reclaim_count?: number;
  /** CONSECUTIVE re-orphan counter (migration 1779990400) — bumped ONLY by the
   * sweeper re-queue path and reset on terminal done|failed. The reaper reads
   * THIS (not reclaim_count) for the MAX_RECLAIM_ATTEMPTS cap check. */
  consecutive_orphan_count?: number;
  /** Re-anchor timestamp (migration 1779990300) the release CAS stamps on a
   * pending re-queue; the reaper's stale-age anchor for a reclaimed row. */
  requeued_at?: string;
}

/**
 * Convert a PB `~`/`!~` LIKE pattern into an anchored RegExp, faithful to
 * PocketBase 0.22's semantics: the SQL is built as `LIKE ... ESCAPE '\'`
 * (pocketbase tools/search/filter.go), so a `\`-escaped `%`/`_` is a LITERAL
 * character while unescaped `%`/`_` are wildcards. The fakes must honor the
 * escape form, or a family containing a wildcard char would over-match here
 * exactly as it would against real PB before the client escaped it.
 *
 * KNOWN LIMITATION (dangling backslash): a pattern ENDING in `\` has nothing
 * to escape — the `i + 1 < pattern.length` guard fails and the trailing `\`
 * falls to the else branch, matching a LITERAL backslash. SQLite's
 * `ESCAPE '\'` behavior for a dangling escape is unspecified-ish; the
 * production clause builders can never emit one (familyClauseSafe rejects
 * backslash-bearing families outright), so the fake's literal reading is
 * just the least-surprising fallback, not a verified PB contract.
 */
function likeToRegExp(pattern: string): RegExp {
  const escapeRegExp = (ch: string): string =>
    ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) {
      out += escapeRegExp(pattern[i + 1]);
      i += 1;
    } else if (ch === "%") {
      out += ".*";
    } else if (ch === "_") {
      out += ".";
    } else {
      out += escapeRegExp(ch);
    }
  }
  return new RegExp(`^${out}$`);
}

/** The row shape the shared filter matcher evaluates. */
interface FilterableRow {
  id: string;
  status: JobStatus;
  probe_key: string;
}

/**
 * Shared `status`/`probe_key` filter evaluation for BOTH fake PB clients
 * (`makeFakePb` + `makePagingPb`). A clause on a field OR OPERATOR the fakes
 * can't honor THROWS loudly — matching the fakes' own unsupported-method
 * philosophy — so a future test exercising an unmodeled filter shape can
 * never pass vacuously by silently matching every row (the original matcher
 * silently match-all'ed e.g. `status != "done"` or any `<`/`>` clause).
 *
 * KNOWN LIMITATION: the operator scan is regex-based over the RAW filter
 * string, so an operator-looking sequence INSIDE a quoted literal would
 * false-positive as a clause (and could throw spuriously). Acceptable here:
 * probe keys are slugs and statuses are bare words, so no quoted literal in
 * these filters legitimately carries operator characters.
 */
function rowMatchesFilter(row: FilterableRow, filter?: string): boolean {
  if (!filter) return true;
  for (const [, field, op] of filter.matchAll(
    /([A-Za-z_][\w.]*)\s*(\?~|\?=|!~|!=|<=|>=|<|>|~|=)/g,
  )) {
    if (field !== "status" && field !== "probe_key" && field !== "id") {
      throw new Error(
        `fake-pb: filter clause on unsupported field "${field}" — only status/probe_key/id are honored (filter: ${filter})`,
      );
    }
    if (field === "status" && op !== "=") {
      throw new Error(
        `fake-pb: status clause with unsupported operator "${op}" — only \`=\` is honored (filter: ${filter})`,
      );
    }
    if (field === "probe_key" && !["=", "!=", "~", "!~"].includes(op)) {
      throw new Error(
        `fake-pb: probe_key clause with unsupported operator "${op}" (filter: ${filter})`,
      );
    }
    // `id` is honored for the NEGATIVE equality only (the discovery
    // by-row-id exclusion for clause-unsafe families); anything else throws
    // per the fakes' philosophy.
    if (field === "id" && op !== "!=") {
      throw new Error(
        `fake-pb: id clause with unsupported operator "${op}" — only \`!=\` is honored (filter: ${filter})`,
      );
    }
  }
  // BOOLEAN-CONNECTIVE GUARD: the evaluation below ORs all POSITIVE clauses
  // per field (faithful to the production inclusion groups, which are
  // `(probe_key ~ x || probe_key = y)` / `(status = a || status = b)`) and
  // ANDs negatives. Two positive clauses for ONE field joined WITHOUT a
  // `||` between them are ANDed in the real grammar — a shape this OR-model
  // would evaluate wrong, so it must throw rather than pass vacuously.
  //
  // KNOWN LIMITATION (interleaved `||`, G1h): the guard only checks that the
  // RAW TEXT between two same-field positives contains a `||` — it is blind
  // to grouping/precedence. A filter like
  // `probe_key = "a" || status = "x" && probe_key = "b"` interleaves a
  // different field between the two probe_key positives; the separator
  // contains `||`, so the guard passes, yet the OR-model flattens what the
  // real grammar binds as `a || (x && b)`. No production builder emits such
  // a shape (inclusion groups are homogeneous parenthesized ORs); a future
  // test that does must extend the matcher, not trust it.
  const assertPositivesOrJoined = (field: string, re: RegExp): void => {
    const ms = [...filter.matchAll(re)];
    for (let i = 1; i < ms.length; i++) {
      const prev = ms[i - 1];
      const sep = filter.slice((prev.index ?? 0) + prev[0].length, ms[i].index);
      if (!sep.includes("||")) {
        throw new Error(
          `fake-pb: multiple positive ${field} clauses ANDed — the OR-model cannot honor this shape (filter: ${filter})`,
        );
      }
    }
  };
  // `(?:~|=)` requires the operator DIRECTLY after the field (`!~`/`!=`
  // never match — the `!` breaks the adjacency), so these scan positives only.
  assertPositivesOrJoined("status", /status\s*=\s*"\w+"/g);
  assertPositivesOrJoined("probe_key", /probe_key\s*(?:~|=)\s*"[^"]*"/g);
  const statuses = [...filter.matchAll(/status\s*=\s*"(\w+)"/g)].map(
    (m) => m[1],
  );
  if (statuses.length > 0 && !statuses.includes(row.status)) return false;
  // id exclusions (ANDed negatives, like the probe_key negatives below).
  for (const m of filter.matchAll(/(?<![\w.])id\s*!=\s*"([^"]*)"/g)) {
    if (row.id === m[1]) return false;
  }
  // KNOWN LIMITATION (value extraction): `"([^"]*)"` stops at the FIRST
  // quote, so a literal containing an ESCAPED quote (`\"`) would be
  // truncated at the escape and the remainder misparsed as filter text.
  // Acceptable here: probe keys are slugs and the client's
  // escapeFilterLiteral only emits `\"` for quote-bearing inputs, which the
  // production builders never receive (and familyClauseSafe rejects the
  // backslash class outright).
  const clauses = [...filter.matchAll(/probe_key\s*(!~|!=|~|=)\s*"([^"]*)"/g)];
  const negatives = clauses.filter((m) => m[1] === "!~" || m[1] === "!=");
  const positives = clauses.filter((m) => m[1] === "~" || m[1] === "=");
  for (const m of negatives) {
    const matches =
      m[1] === "!~"
        ? likeToRegExp(m[2]).test(row.probe_key)
        : row.probe_key === m[2];
    if (matches) return false;
  }
  if (positives.length > 0) {
    const anyMatch = positives.some((m) =>
      m[1] === "~"
        ? likeToRegExp(m[2]).test(row.probe_key)
        : row.probe_key === m[2],
    );
    if (!anyMatch) return false;
  }
  return true;
}

/**
 * Minimal fake PbClient backed by an in-memory row map. Only the methods the
 * queue-client actually calls are implemented; the rest throw so an accidental
 * dependency surfaces loudly rather than silently returning undefined.
 */
function makeFakePb(rows: JobRow[] = []): {
  pb: PbClient;
  rows: JobRow[];
  /** Every filter string passed to deleteByFilter, in call order. */
  deleteFilters: string[];
} {
  const store = [...rows];
  const deleteFilters: string[] = [];
  const unsupported = (name: string) => () => {
    throw new Error(`fake-pb: ${name} not implemented`);
  };
  const pb: PbClient = {
    async create<T>(
      _collection: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      const row: JobRow = {
        id: `j${store.length + 1}`,
        probe_key: String(record.probe_key),
        status: record.status as JobStatus,
        claimed_by: String(record.claimed_by ?? ""),
        lease_expires_at: (record.lease_expires_at as string | null) ?? null,
        version: Number(record.version ?? 0),
        payload: record.payload as ServiceJobPayload,
        // Run-metadata columns (migration 1779990200): capture exactly what
        // enqueue writes so the denormalization tests assert the record body.
        run_id: record.run_id as string | undefined,
        family: record.family as string | undefined,
      };
      store.push(row);
      return row as unknown as T;
    },
    async list<T>(
      _collection: string,
      opts: ListOpts = {},
    ): Promise<ListResult<T>> {
      // Honor `status` AND `probe_key` clauses faithfully (shared matcher) so
      // the claimNext candidate scan, the family-discovery exclusions, and the
      // sweepExpired scans are exercised the way real PB would serve them. A
      // clause on any OTHER field THROWS (see rowMatchesFilter) instead of
      // silently matching everything.
      let items = store.filter((r) => rowMatchesFilter(r, opts.filter));
      // SORT honesty (G1h): this fake used to IGNORE `sort` entirely — any
      // test depending on an order the production query requested passed
      // vacuously on insertion order. Model the two production sort keys
      // (rows here usually lack `created`, where the STABLE sort preserves
      // insertion order — PB's tie behavior for identical values) and THROW
      // on anything else, matching the fakes' unsupported philosophy.
      const desc = opts.sort?.startsWith("-") ?? false;
      const sortKey = desc ? opts.sort!.slice(1) : opts.sort;
      if (sortKey === "created") {
        items = [...items].sort((a, b) =>
          String((a as { created?: string }).created ?? "").localeCompare(
            String((b as { created?: string }).created ?? ""),
          ),
        );
      } else if (sortKey === "lease_expires_at") {
        items = [...items].sort((a, b) =>
          String(a.lease_expires_at ?? "").localeCompare(
            String(b.lease_expires_at ?? ""),
          ),
        );
      } else if (sortKey) {
        throw new Error(
          `fake-pb: unmodeled sort key "${sortKey}" — only created/lease_expires_at are honored`,
        );
      }
      if (desc) items.reverse();
      const totalItems = items.length;
      // PAGING honesty (G1h): perPage used to be ignored — a matched set
      // LARGER than the requested page came back whole, hiding truncation
      // behavior the production pagination depends on. Slice like PB.
      if (opts.perPage !== undefined) {
        const page = opts.page ?? 1;
        items = items.slice((page - 1) * opts.perPage, page * opts.perPage);
      }
      return {
        page: opts.page ?? 1,
        perPage: opts.perPage ?? items.length,
        totalPages:
          opts.skipTotal === true
            ? -1
            : opts.perPage !== undefined
              ? Math.max(1, Math.ceil(totalItems / opts.perPage))
              : 1,
        // Faithful to PB: a skipTotal list returns totalItems -1, NOT the
        // real count. A fake that returned real counts under skipTotal
        // would green-light code reading totals it never requested (the
        // fail-open class countPendingForFamily's skipTotal:false pin
        // exists to prevent).
        totalItems: opts.skipTotal === true ? -1 : totalItems,
        items: items as unknown as T[],
      };
    },
    async getOne<T>(_collection: string, id: string): Promise<T | null> {
      return (store.find((r) => r.id === id) ?? null) as unknown as T | null;
    },
    getFirst: unsupported("getFirst") as PbClient["getFirst"],
    async update<T>(
      _collection: string,
      id: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      const row = store.find((r) => r.id === id);
      if (!row) throw new Error(`fake-pb: update of missing row ${id}`);
      Object.assign(row as unknown as Record<string, unknown>, record);
      return row as unknown as T;
    },
    upsertByField: unsupported("upsertByField") as PbClient["upsertByField"],
    delete: unsupported("delete") as PbClient["delete"],
    // Honor the two clause shapes pruneAged builds — OR-of-`status = "x"`
    // equals plus a `created < "<ISO cutoff>"` age bound — the way the real
    // client would, so the retention-leg tests exercise actual row deletion
    // (survivors stay in `store`) rather than just capturing filter strings.
    // ISO-8601 strings compare lexicographically, so `<` on the raw strings
    // matches PB's date comparison for the canonical shapes seeded here.
    async deleteByFilter(_collection: string, filter: string): Promise<number> {
      deleteFilters.push(filter);
      const statuses = new Set(
        [...filter.matchAll(/status\s*=\s*"(\w+)"/g)].map((mm) => mm[1]),
      );
      const createdMatch = filter.match(/created\s*<\s*"([^"]+)"/);
      const before = store.length;
      for (let i = store.length - 1; i >= 0; i--) {
        const row = store[i];
        const statusOk = statuses.size === 0 || statuses.has(row.status);
        const createdOk =
          !createdMatch ||
          (row.created !== undefined && row.created < createdMatch[1]);
        if (statusOk && createdOk) store.splice(i, 1);
      }
      return before - store.length;
    },
    health: unsupported("health") as PbClient["health"],
    createBackup: unsupported("createBackup") as PbClient["createBackup"],
    downloadBackup: unsupported("downloadBackup") as PbClient["downloadBackup"],
    deleteBackup: unsupported("deleteBackup") as PbClient["deleteBackup"],
  };
  return { pb, rows: store, deleteFilters };
}

/** Configurable fake JobClaimClient — each method is a vi.fn the test wires. */
function makeFakeClaim(
  overrides: Partial<JobClaimClient> = {},
): JobClaimClient {
  return {
    claimJob: vi.fn(async (): Promise<ClaimResult> => ({ won: false })),
    renewLease: vi.fn(async (): Promise<RenewResult> => ({ renewed: false })),
    releaseJob: vi.fn(
      async (): Promise<ReleaseResult> => ({ released: false }),
    ),
    ...overrides,
  };
}

/**
 * An RNG that makes `claimNext`'s Fisher-Yates shuffle a NO-OP (identity order),
 * so a test that depends on the candidate page being tried in its listed order
 * (j1 before j2) is deterministic despite the fairness shuffle. For each
 * descending index `i`, Fisher-Yates picks `j = floor(rng() * (i + 1))`;
 * returning a value just under 1 yields `j = i` every step, leaving the array
 * unchanged. (Production omits `rng` and gets `Math.random` → real shuffle.)
 */
const IDENTITY_ORDER_RNG = (): number => 0.999999999;

function sampleResult(
  overrides: Partial<ServiceJobResult> = {},
): ServiceJobResult {
  return {
    jobId: "j1",
    // NOTE the probe-key POSITION carries the `d6:<slug>` aggregate row key —
    // `e2e_d6` is the DRIVER KIND, which must never leak into a probe key
    // (contracts.ts: "There is NO `e2e_d6:<slug>` row in the fleet path").
    probeKey: "d6:langgraph-python",
    serviceSlug: "langgraph-python",
    runId: "run-1",
    workerId: "worker-7",
    aggregateState: "green",
    aggregateKey: "d6:langgraph-python",
    aggregateSignal: { failedCount: 0 },
    cells: [],
    rollup: { total: 1, passed: 1, failed: 0 },
    finishedAt: "2026-06-04T00:00:02.000Z",
    ...overrides,
  };
}

describe("test-fake honesty (the fakes must throw, not vacuously match)", () => {
  it("rowMatchesFilter throws on operators it cannot honor", () => {
    const row: FilterableRow = {
      id: "r1",
      status: "pending",
      probe_key: "d6:a",
    };
    // Comparison operators are not modeled at all.
    expect(() => rowMatchesFilter(row, 'created < "2026-01-01"')).toThrow(
      /unsupported field/,
    );
    expect(() => rowMatchesFilter(row, 'probe_key > "a"')).toThrow(
      /unsupported operator/,
    );
    expect(() => rowMatchesFilter(row, 'probe_key ?~ "d6:%"')).toThrow(
      /unsupported operator/,
    );
    expect(() => rowMatchesFilter(row, 'probe_key ?= "d6:a"')).toThrow(
      /unsupported operator/,
    );
    // status is only modeled for `=` — negation/LIKE forms used to silently
    // match ALL rows (a vacuous-pass hole for any test that exercised them).
    expect(() => rowMatchesFilter(row, 'status != "done"')).toThrow(
      /status clause with unsupported operator/,
    );
    expect(() => rowMatchesFilter(row, 'status ~ "pend%"')).toThrow(
      /status clause with unsupported operator/,
    );
    expect(() => rowMatchesFilter(row, 'status !~ "done%"')).toThrow(
      /status clause with unsupported operator/,
    );
    // The supported shapes still evaluate.
    expect(rowMatchesFilter(row, 'status = "pending"')).toBe(true);
    expect(rowMatchesFilter(row, 'probe_key !~ "d4:%"')).toBe(true);
  });

  it("rowMatchesFilter throws on boolean-connective shapes its OR-model cannot honor (positives ANDed)", () => {
    // The matcher ORs all positive clauses per field (faithful to the
    // production inclusion groups, which are `(a ~ x || a = y)`), and ANDs
    // negatives. Multiple positive clauses for ONE field joined by `&&`
    // therefore evaluate WRONG (the model would OR what the filter ANDs) —
    // a test exercising that shape must fail loudly, not pass vacuously.
    const row: FilterableRow = {
      id: "r1",
      status: "pending",
      probe_key: "d6:a",
    };
    expect(() =>
      rowMatchesFilter(row, 'probe_key ~ "d6:%" && probe_key ~ "d4:%"'),
    ).toThrow(/positive probe_key clauses ANDed/);
    expect(() =>
      rowMatchesFilter(row, 'probe_key = "d6:a" && probe_key ~ "d6:%"'),
    ).toThrow(/positive probe_key clauses ANDed/);
    expect(() =>
      rowMatchesFilter(row, 'status = "pending" && status = "claimed"'),
    ).toThrow(/positive status clauses ANDed/);
    // The production OR-group shapes stay evaluable.
    expect(
      rowMatchesFilter(
        row,
        'status = "pending" && (probe_key ~ "d6:%" || probe_key = "d6")',
      ),
    ).toBe(true);
    expect(
      rowMatchesFilter(
        row,
        '(status = "pending" || status = "claimed" || status = "running") && (probe_key ~ "d6:%" || probe_key = "d6")',
      ),
    ).toBe(true);
    // Negatives ANDed (the discovery exclusion shape) remain supported.
    expect(
      rowMatchesFilter(
        row,
        'status = "pending" && probe_key !~ "d4:%" && probe_key != "d4"',
      ),
    ).toBe(true);
  });

  it("makeFakePb throws on an unmodeled sort key and honors perPage truncation (no vacuous ordering/paging)", async () => {
    const { pb } = makeFakePb([
      { ...jobView({ id: "j1" }), payload: samplePayload() },
      { ...jobView({ id: "j2" }), payload: samplePayload() },
      { ...jobView({ id: "j3" }), payload: samplePayload() },
    ]);
    // Unmodeled sort key → throw (the fake used to silently not sort).
    await expect(
      pb.list("probe_jobs", { filter: 'status = "pending"', sort: "version" }),
    ).rejects.toThrow(/unmodeled sort key "version"/);
    // perPage smaller than the matched set → truncated like PB (the fake
    // used to return the whole matched set regardless).
    const page = await pb.list("probe_jobs", {
      filter: 'status = "pending"',
      sort: "created",
      perPage: 2,
      skipTotal: true,
    });
    expect(page.items).toHaveLength(2);
  });

  it("the fakes return totalItems -1 under skipTotal (faithful to PB, no fail-open counts)", async () => {
    const { pb } = makeFakePb([
      { ...jobView({ id: "j1" }), payload: samplePayload() },
    ]);
    const skipped = await pb.list("probe_jobs", {
      filter: 'status = "pending"',
      skipTotal: true,
    });
    expect(skipped.totalItems).toBe(-1);
    const counted = await pb.list("probe_jobs", {
      filter: 'status = "pending"',
      skipTotal: false,
    });
    expect(counted.totalItems).toBe(1);
  });
});

describe("FleetQueueClient.enqueue", () => {
  it("writes a pending probe_jobs row carrying the serialized payload", async () => {
    const { pb, rows } = makeFakePb();
    const claim = makeFakeClaim();
    const q = createFleetQueueClient({ pb, claim, logger });

    const input: EnqueueJobInput = { payload: samplePayload() };
    const view = await q.enqueue(input);

    expect(view.status).toBe("pending");
    expect(view.probe_key).toBe("d6:langgraph-python");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].claimed_by).toBe("");
    expect(rows[0].payload).toEqual(samplePayload());
  });

  it("rejects a non-number meta.priority at the enqueue boundary (optional fields still have required shapes)", async () => {
    // `priority` is the one optional META field; like cellIds/driverInputs
    // it must have its required shape WHEN PRESENT. The untrusted JSON
    // column could carry priority: "high" — accepted silently today, it
    // round-trips to any future claimNext priority consumer as a non-number.
    const { pb, rows } = makeFakePb();
    const q = createFleetQueueClient({ pb, claim: makeFakeClaim(), logger });

    const poisoned = samplePayload();
    poisoned.meta = { ...poisoned.meta, priority: "high" as unknown as number };
    await expect(q.enqueue({ payload: poisoned })).rejects.toThrow(/priority/i);
    expect(rows).toHaveLength(0);

    // A NUMBER priority (and an absent one) still passes.
    const fine = samplePayload();
    fine.meta = { ...fine.meta, priority: 5 };
    await q.enqueue({ payload: fine });
    await q.enqueue({ payload: samplePayload() });
    expect(rows).toHaveLength(2);
  });

  it("validates the payload BEFORE creating the row (no poison row persisted)", async () => {
    // enqueue used to deref payload.meta.runId only AFTER pb.create — a
    // malformed caller payload threw AFTER persisting an undecodable row,
    // i.e. a poison row every claimer then has to release-as-failed. The
    // validation must run first so nothing is written.
    const { pb, rows } = makeFakePb();
    const createSpy = vi.fn(pb.create.bind(pb));
    pb.create = createSpy as PbClient["create"];
    const claim = makeFakeClaim();
    const q = createFleetQueueClient({ pb, claim, logger });

    const badPayload = {
      ...samplePayload(),
      meta: "not-an-object",
    } as unknown as ServiceJobPayload;
    await expect(q.enqueue({ payload: badPayload })).rejects.toThrow(/meta/i);
    expect(createSpy).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("rejects a top-level ARRAY payload — the expando hole the nested meta check already closes", async () => {
    // An array is `typeof "object"` and (as an in-process caller value) can
    // carry expando fields that satisfy every per-field check below — the
    // exact hole the meta check's Array.isArray guard closes one level down
    // (and contracts' commErrorFromStatusSignal guards at its boundary). A
    // top-level array payload is never a valid ServiceJobPayload; reject it
    // before anything persists.
    const { pb, rows } = makeFakePb();
    const createSpy = vi.fn(pb.create.bind(pb));
    pb.create = createSpy as PbClient["create"];
    const claim = makeFakeClaim();
    const q = createFleetQueueClient({ pb, claim, logger });

    const expandoArray = Object.assign(
      [],
      samplePayload(),
    ) as unknown as ServiceJobPayload;
    await expect(q.enqueue({ payload: expandoArray })).rejects.toThrow(
      /no decodable payload/i,
    );
    expect(createSpy).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("rejects the documented forbidden EMPTY sentinels (probeKey/serviceSlug/driverKind/runId) before creating the row (G1c)", async () => {
    // emptyPayloadForLease documents empty serviceSlug/runId (and the rest)
    // as FORBIDDEN aggregation inputs: an empty runId groups into nothing in
    // the aggregator, an empty serviceSlug corrupts the per-service rollup,
    // and an empty probeKey yields the empty FAMILY whose filter clauses
    // match every leading-colon key (the partition gap familyClauseSafe now
    // refuses). The typeof checks alone admitted all four — the boundary
    // must require non-empty strings.
    const { pb, rows } = makeFakePb();
    const createSpy = vi.fn(pb.create.bind(pb));
    pb.create = createSpy as PbClient["create"];
    const claim = makeFakeClaim();
    const q = createFleetQueueClient({ pb, claim, logger });

    const empties: Array<Partial<ServiceJobPayload>> = [
      { probeKey: "" },
      { serviceSlug: "" },
      { driverKind: "" },
      { meta: { ...samplePayload().meta, runId: "" } },
      // enqueuedAt: "" is `emptyPayloadForLease`'s never-aggregate sentinel
      // — minted ONLY for heartbeat-only renew fallbacks, never decoded
      // through this boundary. A caller-supplied empty enqueuedAt is the
      // same forbidden class as the other empties: reject it.
      { meta: { ...samplePayload().meta, enqueuedAt: "" } },
    ];
    for (const overrides of empties) {
      await expect(
        q.enqueue({ payload: samplePayload(overrides) }),
      ).rejects.toThrow(/non-empty/i);
    }
    expect(createSpy).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("denormalizes payload.meta.runId into the run_id column", async () => {
    // §4.2: run_id rides an indexed column so the run-view projection can
    // group a batch with a filter instead of a JSON-path scan over payload.
    const { pb, rows } = makeFakePb();
    const claim = makeFakeClaim();
    const q = createFleetQueueClient({ pb, claim, logger });

    await q.enqueue({ payload: samplePayload() });

    expect(rows[0].run_id).toBe("run-1");
  });

  it("stamps the family column when EnqueueJobInput.family is present", async () => {
    const { pb, rows } = makeFakePb();
    const claim = makeFakeClaim();
    const q = createFleetQueueClient({ pb, claim, logger });

    await q.enqueue({ payload: samplePayload(), family: "d6" });

    expect(rows[0].family).toBe("d6");
  });

  it("writes empty family when the input omits it (pre-P2 row parity)", async () => {
    // An absent family must write the column EMPTY — matching rows enqueued
    // before P2, which the new per-family API simply never selects.
    const { pb, rows } = makeFakePb();
    const claim = makeFakeClaim();
    const q = createFleetQueueClient({ pb, claim, logger });

    await q.enqueue({ payload: samplePayload() });

    expect(rows[0].family).toBe("");
  });
});

describe("FleetQueueClient.claimNext", () => {
  it("claims the next pending job and returns a lease with the decoded payload", async () => {
    const payload = samplePayload();
    const { pb } = makeFakePb([{ ...jobView(), payload }]);
    const claim = makeFakeClaim({
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({
            id: jobId,
            status: "claimed",
            claimed_by: workerId,
            lease_expires_at: "2026-06-04T00:01:00.000Z",
            version: 1,
          }),
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const claimed = await q.claimNext("worker-7", 30);

    expect(claim.claimJob).toHaveBeenCalledWith("j1", "worker-7", 30);
    expect(claimed.claimed).toBe(true);
    expect(claimed.lease?.job.claimed_by).toBe("worker-7");
    expect(claimed.lease?.payload).toEqual(payload);
    expect(claimed.lease?.leaseExpiresAt).toBe("2026-06-04T00:01:00.000Z");
  });

  it("enqueue → claimNext round-trips the payload through the row", async () => {
    const { pb, rows } = makeFakePb();
    const claim = makeFakeClaim({
      claimJob: vi.fn(async (jobId, workerId): Promise<ClaimResult> => {
        const row = rows.find((r) => r.id === jobId);
        return {
          won: true,
          job: jobView({
            id: jobId,
            probe_key: row?.probe_key ?? "",
            status: "claimed",
            claimed_by: workerId,
            lease_expires_at: "2026-06-04T00:01:00.000Z",
            version: 1,
          }),
        };
      }),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const payload = samplePayload({ cellIds: ["shared-state"] });
    await q.enqueue({ payload });
    const claimed = await q.claimNext("worker-7", 30);

    expect(claimed.claimed).toBe(true);
    expect(claimed.lease?.payload).toEqual(payload);
  });

  it("reports not-claimed when no pending jobs exist", async () => {
    const { pb } = makeFakePb();
    const claim = makeFakeClaim();
    const q = createFleetQueueClient({ pb, claim, logger });

    const claimed = await q.claimNext("worker-7", 30);

    expect(claimed.claimed).toBe(false);
    expect(claimed.lease).toBeUndefined();
    expect(claim.claimJob).not.toHaveBeenCalled();
  });

  it("releases and skips a won job whose payload fails to decode (never strands it)", async () => {
    // The CAS WON on j1, but its row payload is garbage (null) → decodePayload
    // throws. The job is already claimed/owned; if claimNext let the throw
    // escape, the job would be stranded (re-listed + re-thrown forever, then a
    // FALSE worker-crashed when the sweeper reclaims it). Instead it must
    // release the won job as `failed` and fall through to the next candidate.
    const { pb } = makeFakePb([
      // j1's payload is non-decodable; cast through unknown to seed garbage.
      {
        ...jobView({ id: "j1" }),
        payload: null as unknown as ServiceJobPayload,
      },
      { ...jobView({ id: "j2" }), payload: samplePayload() },
    ]);
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({
      releaseJob,
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        }),
      ),
    });
    // Identity-order rng so j1 (the poison row) is tried before j2 despite the
    // fairness shuffle — this test pins the decode-failure release on j1.
    const q = createFleetQueueClient({
      pb,
      claim,
      logger,
      rng: IDENTITY_ORDER_RNG,
    });

    // Must NOT throw — the decode failure on the won j1 is contained.
    const claimed = await q.claimNext("worker-7", 30);

    // j1 was released as failed (we owned it), then j2 was claimed.
    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-7", "failed");
    expect(claimed.claimed).toBe(true);
    expect(claimed.lease?.job.id).toBe("j2");
  });

  it("treats a payload with a non-object meta as a decode failure (releases + skips)", async () => {
    // decodePayload must assert `meta` is a non-null object with a string
    // runId, failing LOUD at the boundary — a string/array meta satisfies the
    // `meta !== undefined` check but would deref to undefined deep in the
    // aggregator (it groups by meta.runId). The won job is released + skipped.
    const badMetaPayload = {
      ...samplePayload(),
      meta: "not-an-object",
    } as unknown as ServiceJobPayload;
    const { pb } = makeFakePb([
      { ...jobView({ id: "j1" }), payload: badMetaPayload },
      { ...jobView({ id: "j2" }), payload: samplePayload() },
    ]);
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({
      releaseJob,
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        }),
      ),
    });
    // Identity-order rng so j1 (the bad-meta row) is tried before j2 despite the
    // fairness shuffle.
    const q = createFleetQueueClient({
      pb,
      claim,
      logger,
      rng: IDENTITY_ORDER_RNG,
    });

    const claimed = await q.claimNext("worker-7", 30);

    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-7", "failed");
    expect(claimed.claimed).toBe(true);
    expect(claimed.lease?.job.id).toBe("j2");
  });

  it("treats malformed meta.triggered/meta.enqueuedAt/cellIds/driverInputs as decode failures (releases + skips)", async () => {
    // decodePayload used to validate only probeKey/serviceSlug/driverKind and
    // meta.runId — the REST of the payload (meta.triggered, meta.enqueuedAt,
    // cellIds, driverInputs) was cast through unchecked, deferring malformed
    // shapes to undefined derefs deep in the worker/aggregator. Each bad
    // shape must fail LOUD at this boundary: release the won row, move on.
    const bad = (id: string, payload: unknown): JobRow => ({
      ...jobView({ id }),
      payload: payload as ServiceJobPayload,
    });
    const { pb } = makeFakePb([
      bad("j1", {
        ...samplePayload(),
        meta: { ...samplePayload().meta, triggered: "yes" },
      }),
      bad("j2", {
        ...samplePayload(),
        meta: { ...samplePayload().meta, enqueuedAt: 1234 },
      }),
      bad("j3", { ...samplePayload(), cellIds: "shared-state" }),
      bad("j4", { ...samplePayload(), driverInputs: ["not", "a", "record"] }),
      { ...jobView({ id: "j5" }), payload: samplePayload() },
    ]);
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({
      releaseJob,
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        }),
      ),
    });
    // Identity order: poison rows j1–j4 are tried before the good j5.
    const q = createFleetQueueClient({
      pb,
      claim,
      logger,
      rng: IDENTITY_ORDER_RNG,
    });

    const claimed = await q.claimNext("worker-7", 30);

    for (const id of ["j1", "j2", "j3", "j4"]) {
      expect(releaseJob).toHaveBeenCalledWith(id, "worker-7", "failed");
    }
    expect(claimed.claimed).toBe(true);
    expect(claimed.lease?.job.id).toBe("j5");
  });

  it("treats the forbidden empty sentinels in a CLAIMED row's payload as decode failures (releases + skips) — G1c decode boundary", async () => {
    // The encode and decode boundaries share assertServiceJobPayload, so the
    // non-empty requirement must fail loud at BOTH ends: a row persisted by
    // an older writer (or hand-edited) with an empty probeKey/serviceSlug/
    // driverKind/runId is released as failed and skipped, never handed to
    // the worker (where the empty sentinels corrupt aggregation).
    const bad = (
      id: string,
      overrides: Partial<ServiceJobPayload>,
    ): JobRow => ({
      ...jobView({ id }),
      payload: samplePayload(overrides),
    });
    const { pb } = makeFakePb([
      bad("j1", { probeKey: "" }),
      bad("j2", { serviceSlug: "" }),
      bad("j3", { driverKind: "" }),
      bad("j4", { meta: { ...samplePayload().meta, runId: "" } }),
      { ...jobView({ id: "j5" }), payload: samplePayload() },
    ]);
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({
      releaseJob,
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        }),
      ),
    });
    // Identity order: poison rows j1–j4 are tried before the good j5.
    const q = createFleetQueueClient({
      pb,
      claim,
      logger,
      rng: IDENTITY_ORDER_RNG,
    });

    const claimed = await q.claimNext("worker-7", 30);

    for (const id of ["j1", "j2", "j3", "j4"]) {
      expect(releaseJob).toHaveBeenCalledWith(id, "worker-7", "failed");
    }
    expect(claimed.claimed).toBe(true);
    expect(claimed.lease?.job.id).toBe("j5");
  });

  it("attributes a decode-failed row as worker-protocol-violation via a synthetic result (not a crash)", async () => {
    // After the decode-fail release the row is terminal-but-RESULTLESS; the
    // result consumer's contract synthesizes worker-crashed-mid-job (a RED
    // "crashed" overlay) for such rows past grace. A poison payload is a
    // PROTOCOL failure, not a crash — the queue-client must write a synthetic
    // result carrying a worker-protocol-violation commError so the consumer
    // renders the honest signal.
    const { pb, rows } = makeFakePb([
      {
        ...jobView({ id: "j1" }),
        payload: null as unknown as ServiceJobPayload,
      },
    ]);
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({
      releaseJob,
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const claimed = await q.claimNext("worker-7", 30);

    expect(claimed.claimed).toBe(false);
    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-7", "failed");
    // The synthetic result landed on the row, unprocessed, attributing the
    // poison payload — NOT left for the consumer's crash synthesis.
    const written = rows[0].result as ServiceJobResult;
    expect(written.commError?.kind).toBe("worker-protocol-violation");
    expect(written.commError?.jobId).toBe("j1");
    expect(written.commError?.workerId).toBe("worker-7");
    expect(written.jobId).toBe("j1");
    expect(written.workerId).toBe("worker-7");
    // No decodable payload → aggregate key falls back to the row's probe_key.
    expect(written.aggregateKey).toBe("d6:langgraph-python");
    expect(written.aggregateState).toBe("error");
    // The result must NOT carry the empty sentinels emptyPayloadForLease
    // forbids feeding aggregation: serviceSlug is recovered from the
    // probe_key's slug segment, and runId is a non-colliding synthetic id
    // (an empty runId would silently group into nothing downstream).
    expect(written.serviceSlug).toBe("langgraph-python");
    expect(written.runId).toBe("pviol_j1");
    expect(rows[0].result_processed).toBe(false);
  });

  it("a releaseJob THROW during decode-fail cleanup must not strand the loop (warn + continue)", async () => {
    // The decode-fail release can THROW (transport blip), not just refuse.
    // claimNext must contain it — warn and fall through to the next
    // candidate — or the whole claim poll dies on one poison row.
    const { pb } = makeFakePb([
      {
        ...jobView({ id: "j1" }),
        payload: null as unknown as ServiceJobPayload,
      },
      { ...jobView({ id: "j2" }), payload: samplePayload() },
    ]);
    const releaseJob = vi.fn(async (): Promise<ReleaseResult> => {
      throw new Error("release transport blip");
    });
    const claim = makeFakeClaim({
      releaseJob,
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        }),
      ),
    });
    // Identity-order rng: j1 (poison) before j2.
    const q = createFleetQueueClient({
      pb,
      claim,
      logger,
      rng: IDENTITY_ORDER_RNG,
    });

    const claimed = await q.claimNext("worker-7", 30);

    expect(claimed.claimed).toBe(true);
    expect(claimed.lease?.job.id).toBe("j2");
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.claim-decode-release-failed",
      expect.objectContaining({
        jobId: "j1",
        err: "release transport blip",
      }),
    );
  });

  it("warns (with the hook's reason) when the decode-failure release is REFUSED", async () => {
    // The decode-fail cleanup logged thrown releases but a REFUSED release
    // (released:false) was silent — the poison row stays claimed with no
    // breadcrumb tying the refusal to the decode failure. Warn with the
    // hook's refusal reason.
    const { pb } = makeFakePb([
      {
        ...jobView({ id: "j1" }),
        payload: null as unknown as ServiceJobPayload,
      },
    ]);
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({
          released: false,
          reason: "refused_not_holder",
        }),
      ),
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const claimed = await q.claimNext("worker-7", 30);

    expect(claimed.claimed).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.claim-decode-release-refused",
      expect.objectContaining({ jobId: "j1", reason: "refused_not_holder" }),
    );
  });

  it("recovers a non-empty serviceSlug for the synthetic result when the probe_key's slug segment is EMPTY", async () => {
    // probeKeySlug("d6:") sliced to "" — the exact empty sentinel the
    // synthetic worker-protocol-violation result is forbidden to carry
    // (an empty serviceSlug corrupts the per-service rollup). An empty slug
    // segment falls back to the WHOLE probe_key; a fully-empty probe_key
    // falls back to a jobId-derived placeholder.
    const { pb, rows } = makeFakePb([
      {
        ...jobView({ id: "j1", probe_key: "d6:" }),
        payload: null as unknown as ServiceJobPayload,
      },
    ]);
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({ released: true }),
      ),
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          // Carry the SAME probe_key on the CAS view as the listed row: the
          // fixture must not pin which internal source (candidate row vs
          // returned view) the synthesis reads the key from.
          job: jobView({
            id: jobId,
            probe_key: "d6:",
            status: "claimed",
            claimed_by: workerId,
          }),
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    await q.claimNext("worker-7", 30);

    const written = rows[0].result as ServiceJobResult;
    expect(written.serviceSlug).toBe("d6:");
    expect(written.serviceSlug).not.toBe("");
  });

  it("skips an empty-probe_key row at discovery (its family is the clause-unsafe empty family) — never claimed (G1c)", async () => {
    // probeKeyFamily("") === "" is the clause-unsafe EMPTY family (its
    // prefix-LIKE clauses would match every leading-colon key), so an
    // empty-probe_key row is excluded from discovery/claiming entirely with
    // the charset-guard warn — it can no longer reach the decode-failure
    // synthesis at all. (The synthesis call site keeps its jobId-derived
    // `unknown-<jobId>` serviceSlug fallback as defense-in-depth for any
    // future claim path that hands it an empty probe_key.)
    const { pb, rows } = makeFakePb([
      {
        ...jobView({ id: "j1", probe_key: "" }),
        payload: null as unknown as ServiceJobPayload,
      },
    ]);
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({ released: true }),
      ),
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({
            id: jobId,
            probe_key: "",
            status: "claimed",
            claimed_by: workerId,
          }),
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const claimed = await q.claimNext("worker-7", 30);

    expect(claimed.claimed).toBe(false);
    expect(claim.claimJob).not.toHaveBeenCalled();
    expect(rows[0].result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.family-clause-unsafe",
      expect.objectContaining({ family: "" }),
    );
  });

  it("contains a won-without-job breach with a TERMINAL 'failed' release + synthetic worker-protocol-violation result (G1e)", async () => {
    // won:true with NO job view violates the endpoint contract — but the
    // CAS may genuinely have committed, so this worker may now OWN the row
    // under a LIVE, just-minted lease. A release back to `pending` can NEVER
    // succeed there: the hook refuses EVERY pending-target release while the
    // row's lease is live (refused_lease_live — no holder exemption) and
    // refused_not_holder otherwise, so a pending-target containment is
    // INERT — the row wedges a full lease window and the sweeper later
    // paints a FALSE worker-reclaimed-pending overlay. A TERMINAL target
    // passes the live-lease gate (the expiry gate only rejects EXPIRED
    // leases), so the containment mirrors the decode-failure path: release
    // `failed` + a synthetic worker-protocol-violation result.
    const NOW = Date.parse("2026-06-04T00:00:00.000Z");
    const { pb, rows } = makeFakePb([
      { ...jobView({ id: "j1" }), payload: samplePayload() },
    ]);
    const claimJob = vi.fn(
      async (jobId: string, workerId: string): Promise<ClaimResult> => {
        // The CAS COMMITTED (row claimed under a live lease) but the
        // response lost its job view — the breach under containment.
        const row = rows.find((r) => r.id === jobId)!;
        row.status = "claimed";
        row.claimed_by = workerId;
        row.lease_expires_at = new Date(NOW + 30_000).toISOString();
        return { won: true };
      },
    );
    // Hook-faithful releaseJob (fleet-claim.pb.js /api/fleet/release):
    // authorizes on claimed_by; REFUSES a pending-target release while the
    // CURRENT lease is live (refused_lease_live — the TOCTOU close, no
    // holder exemption) and a terminal-target release on an EXPIRED lease
    // (refused_not_holder). Expiry via the exported leaseExpired so the
    // fake stays byte-equivalent with both sides of the contract.
    const releaseJob = vi.fn(
      async (
        jobId: string,
        workerId: string,
        status: "done" | "failed" | "pending",
      ): Promise<ReleaseResult> => {
        const row = rows.find((r) => r.id === jobId);
        if (!row || !["claimed", "running"].includes(row.status)) {
          return { released: false, reason: "refused_not_holder" };
        }
        if (row.claimed_by !== workerId) {
          return { released: false, reason: "refused_not_holder" };
        }
        if (status === "pending" && !leaseExpired(row.lease_expires_at, NOW)) {
          return { released: false, reason: "refused_lease_live" };
        }
        if (status !== "pending" && leaseExpired(row.lease_expires_at, NOW)) {
          return { released: false, reason: "refused_not_holder" };
        }
        row.status = status;
        if (status === "pending") row.claimed_by = "";
        return { released: true, job: { ...row } };
      },
    );
    const claim = makeFakeClaim({ claimJob, releaseJob });
    const q = createFleetQueueClient({ pb, claim, logger, now: () => NOW });

    const claimed = await q.claimNext("worker-7", 30);

    expect(claimed.claimed).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.claim-won-without-job",
      expect.objectContaining({ jobId: "j1" }),
    );
    // TERMINAL release — never the inert pending target (the hook-faithful
    // fake would refuse it refused_lease_live).
    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-7", "failed");
    expect(releaseJob).not.toHaveBeenCalledWith("j1", "worker-7", "pending");
    expect(rows[0].status).toBe("failed");
    // The synthetic result attributes the breach honestly (the taxonomy's
    // protocol-violation kind, never a crash synthesis) and respects the
    // no-empty-sentinel contract (slug recovered from probe_key, minted
    // runId).
    const result = rows[0].result as ServiceJobResult;
    expect(result.commError?.kind).toBe("worker-protocol-violation");
    expect(result.jobId).toBe("j1");
    expect(result.workerId).toBe("worker-7");
    expect(result.aggregateState).toBe("error");
    expect(result.aggregateKey).toBe("d6:langgraph-python");
    expect(result.serviceSlug).toBe("langgraph-python");
    expect(result.runId).not.toBe("");
    expect(rows[0].result_processed).toBe(false);
  });

  it("a REFUSED won-without-job terminal release writes nothing — the CAS never actually committed (G1e)", async () => {
    // Contrast: the breach response may ALSO mean the CAS did NOT commit
    // (this worker never owned the row). The hook then refuses the terminal
    // release (refused_not_holder) — warn with the threaded reason, write NO
    // result, and fall through.
    const { pb, rows } = makeFakePb([
      { ...jobView({ id: "j1" }), payload: samplePayload() },
    ]);
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({
        released: false,
        reason: "refused_not_holder",
      }),
    );
    const claim = makeFakeClaim({
      releaseJob,
      // Breach without a commit: the row is untouched (still pending).
      claimJob: vi.fn(async (): Promise<ClaimResult> => ({ won: true })),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const claimed = await q.claimNext("worker-7", 30);

    expect(claimed.claimed).toBe(false);
    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-7", "failed");
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.claim-won-without-job-release-refused",
      expect.objectContaining({ jobId: "j1", reason: "refused_not_holder" }),
    );
    expect(rows[0].result).toBeUndefined();
    expect(rows[0].status).toBe("pending");
  });

  it("a THROWN won-without-job release is swallowed with a warn — best-effort only (G1e)", async () => {
    const { pb } = makeFakePb([
      { ...jobView({ id: "j1" }), payload: samplePayload() },
      { ...jobView({ id: "j2" }), payload: samplePayload() },
    ]);
    const claim = makeFakeClaim({
      releaseJob: vi.fn(async (): Promise<ReleaseResult> => {
        throw new Error("release transport blip");
      }),
      claimJob: vi.fn(async (jobId, workerId): Promise<ClaimResult> => {
        if (jobId === "j1") return { won: true }; // breach on j1
        return {
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        };
      }),
    });
    // Identity order: the breach row j1 is tried before the healthy j2.
    const q = createFleetQueueClient({
      pb,
      claim,
      logger,
      rng: IDENTITY_ORDER_RNG,
    });

    const claimed = await q.claimNext("worker-7", 30);

    // The throw did not abort the rotation; j2 still claimed.
    expect(claimed.claimed).toBe(true);
    expect(claimed.lease?.job.id).toBe("j2");
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.claim-won-without-job-release-failed",
      expect.objectContaining({ jobId: "j1", err: "release transport blip" }),
    );
  });

  it("returns { claimed: false } when EVERY candidate decode-fails (no throw, nothing stranded)", async () => {
    const { pb } = makeFakePb([
      {
        ...jobView({ id: "j1" }),
        payload: null as unknown as ServiceJobPayload,
      },
      {
        ...jobView({ id: "j2" }),
        payload: "garbage" as unknown as ServiceJobPayload,
      },
    ]);
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({
      releaseJob,
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const claimed = await q.claimNext("worker-7", 30);

    expect(claimed.claimed).toBe(false);
    expect(claimed.lease).toBeUndefined();
    // Both poison rows were released (none stranded for a false crash).
    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-7", "failed");
    expect(releaseJob).toHaveBeenCalledWith("j2", "worker-7", "failed");
  });

  it("a claimJob THROW on one candidate does not abort the rotation (warn + continue)", async () => {
    // A transport blip on the claim CAS is indistinguishable from losing the
    // race — a thrown claim used to escape raceCandidates and abort the
    // WHOLE rotation (every remaining candidate and every remaining family
    // unclaimed for this poll). Contain it per candidate: warn + continue.
    const { pb } = makeFakePb([
      { ...jobView({ id: "j1" }), payload: samplePayload() },
      { ...jobView({ id: "j2" }), payload: samplePayload() },
    ]);
    const claim = makeFakeClaim({
      claimJob: vi.fn(async (jobId, workerId): Promise<ClaimResult> => {
        if (jobId === "j1") throw new Error("claim transport blip");
        return {
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        };
      }),
    });
    // Identity-order rng: j1 (the thrower) before j2.
    const q = createFleetQueueClient({
      pb,
      claim,
      logger,
      rng: IDENTITY_ORDER_RNG,
    });

    const claimed = await q.claimNext("worker-7", 30);

    expect(claimed.claimed).toBe(true);
    expect(claimed.lease?.job.id).toBe("j2");
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.claim-cas-threw",
      expect.objectContaining({ jobId: "j1", err: "claim transport blip" }),
    );
  });

  it("the decode-failure synthetic result write is SINGLE-attempt — no retry pacing inside the claim race (G1g)", async () => {
    // The synthetic write is best-effort with a documented backstop (the
    // consumer's crash synthesis), so the bounded-retry + 250ms pacing of
    // report()'s writeResult is pure latency injected into claimNext's
    // candidate race — up to 500ms of sleeps per poison row while the whole
    // claim poll waits. One attempt + the lost warn is the contract.
    const { pb } = makeFakePb([
      {
        ...jobView({ id: "j1" }),
        payload: null as unknown as ServiceJobPayload,
      },
    ]);
    const updateSpy = vi.fn(async () => {
      throw new Error("pb write blip");
    });
    pb.update = updateSpy as PbClient["update"];
    const sleeps: number[] = [];
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({ released: true }),
      ),
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        }),
      ),
    });
    const q = createFleetQueueClient({
      pb,
      claim,
      logger,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });

    const claimed = await q.claimNext("worker-7", 30);

    expect(claimed.claimed).toBe(false);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.claim-decode-result-write-lost",
      expect.objectContaining({ jobId: "j1", err: "pb write blip" }),
    );
  });

  it("uses the injected clock for the decode-failure synthetic result's timestamps", async () => {
    // The synthetic worker-protocol-violation result used `new Date()`
    // directly while the rest of the queue layer takes injected time —
    // making the observedAt/finishedAt unpinnable in tests and inconsistent
    // under clock control. The client's `now` config (default Date.now) is
    // the clock source.
    const FIXED = Date.parse("2026-06-05T01:02:03.000Z");
    const { pb, rows } = makeFakePb([
      {
        ...jobView({ id: "j1" }),
        payload: null as unknown as ServiceJobPayload,
      },
    ]);
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({ released: true }),
      ),
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        }),
      ),
    });
    const q = createFleetQueueClient({
      pb,
      claim,
      logger,
      now: () => FIXED,
    });

    await q.claimNext("worker-7", 30);

    const written = rows[0].result as ServiceJobResult;
    expect(written.commError?.observedAt).toBe("2026-06-05T01:02:03.000Z");
    expect(written.finishedAt).toBe("2026-06-05T01:02:03.000Z");
  });

  it("warns before the defensive duplicate-family break (a backend ignoring exclusions must be observable)", async () => {
    // Family discovery relies on the exclusion clause shrinking each query's
    // result. A backend that ignores it would re-yield the same family
    // forever; the defensive break stops the spin but used to be SILENT —
    // hiding both the backend defect and every undiscovered family.
    const sameHead = { ...jobView({ id: "h1" }), payload: samplePayload() };
    const pb = {
      ...makeFakePb([sameHead]).pb,
      // Ignore ALL filters: every list returns the same head row.
      async list<T>(): Promise<ListResult<T>> {
        return {
          page: 1,
          perPage: 1,
          totalPages: 1,
          totalItems: 1,
          items: [sameHead] as unknown as T[],
        };
      },
    } as PbClient;
    const claim = makeFakeClaim({
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const claimed = await q.claimNext("worker-7", 30);

    expect(claimed.claimed).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.family-discovery-duplicate",
      expect.objectContaining({ family: "d6" }),
    );
  });

  it("falls through to the next candidate when it loses the CAS on the first", async () => {
    const { pb } = makeFakePb([
      { ...jobView({ id: "j1" }), payload: samplePayload() },
      { ...jobView({ id: "j2" }), payload: samplePayload() },
    ]);
    const claim = makeFakeClaim({
      claimJob: vi.fn(async (jobId, workerId): Promise<ClaimResult> => {
        if (jobId === "j1") return { won: false };
        return {
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        };
      }),
    });
    // Identity-order rng so the CAS-loss-then-fall-through is deterministic: j1
    // is tried first (lost), then j2 (won) — exactly 2 attempts. The fairness
    // shuffle (production default) would otherwise randomize which is tried
    // first; this test pins the fall-through mechanism, not the ordering.
    const q = createFleetQueueClient({
      pb,
      claim,
      logger,
      rng: IDENTITY_ORDER_RNG,
    });

    const claimed = await q.claimNext("worker-7", 30);

    expect(claim.claimJob).toHaveBeenCalledTimes(2);
    expect(claimed.claimed).toBe(true);
    expect(claimed.lease?.job.id).toBe("j2");
  });
});

describe("FleetQueueClient.claimNext — CLAIM FAIRNESS (Part B contention)", () => {
  // ── ROOT CAUSE ──────────────────────────────────────────────────────────────
  // Every worker lists the SAME deterministically-ordered pending page (PB's
  // default order is caller-independent) and USED to attack it HEAD-FIRST — so
  // all 6 replicas thunder on the same head row every poll. Under the atomic
  // exactly-one-winner CAS only one wins the head; the losers serialize behind
  // it, burning extra CAS round-trips walking the list. Those extra round-trips
  // are latency: a loser re-polls later, claims less, and the worker that keeps
  // winning the head compounds into a ~4x hot outlier (the staging skew that
  // tipped legit settles past the per-turn budget).
  //
  // ── THE FIX (what this test pins) ────────────────────────────────────────────
  // `claimNext` now SHUFFLES its candidate-attempt order per poll. The
  // load-bearing change is the ATTEMPT ORDER: instead of every worker trying the
  // SAME head row first (the herd), each worker tries a DIFFERENT first
  // candidate, so the herd spreads across the whole page and a worker rarely has
  // to walk past a peer-held head to find a free job. These tests assert that
  // distribution of FIRST-attempted candidates directly: head-first concentrates
  // every poll on index 0; the shuffle spreads first-attempts uniformly.

  interface ListedRow {
    id: string;
    payload: ServiceJobPayload;
  }

  /** A pb that lists a FIXED ordered pending page (the shared snapshot all
   *  workers see). Only `list` is exercised — claimNext never mutates here.
   *
   *  DELIBERATE FILTER BLINDNESS: this fake ignores ALL filters — including
   *  the family-discovery EXCLUSION clauses — so every discovery iteration
   *  re-yields the same head family and claimNext proceeds via the
   *  duplicate-family defensive break (with its warn). That coupling is the
   *  point: these fairness tests pin the per-poll ATTEMPT ORDER over one
   *  fixed page, not the multi-family rotation (covered by the
   *  filter-honoring `makeFakePb`/`makePagingPb` suites). Throwing on
   *  exclusion clauses here would break discovery before any attempt
   *  histogram could be collected. */
  function makeOrderedPb(orderedIds: string[]): PbClient {
    const unsupported = (name: string) => () => {
      throw new Error(`ordered-pb: ${name} not implemented`);
    };
    return {
      async list<T>(_c: string, opts: ListOpts = {}): Promise<ListResult<T>> {
        const items: ListedRow[] = orderedIds.map((id) => ({
          ...jobView({ id, status: "pending" }),
          payload: samplePayload(),
        }));
        return {
          page: 1,
          perPage: opts.perPage ?? items.length,
          totalPages: 1,
          totalItems: items.length,
          items: items as unknown as T[],
        };
      },
      create: unsupported("create") as PbClient["create"],
      getOne: unsupported("getOne") as PbClient["getOne"],
      getFirst: unsupported("getFirst") as PbClient["getFirst"],
      update: unsupported("update") as PbClient["update"],
      upsertByField: unsupported("upsertByField") as PbClient["upsertByField"],
      delete: unsupported("delete") as PbClient["delete"],
      deleteByFilter: unsupported(
        "deleteByFilter",
      ) as PbClient["deleteByFilter"],
      health: unsupported("health") as PbClient["health"],
      createBackup: unsupported("createBackup") as PbClient["createBackup"],
      downloadBackup: unsupported(
        "downloadBackup",
      ) as PbClient["downloadBackup"],
      deleteBackup: unsupported("deleteBackup") as PbClient["deleteBackup"],
    };
  }

  // Seeded deterministic PRNG so the shuffled run is reproducible (mulberry32).
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const PAGE_IDS = Array.from({ length: 12 }, (_, i) => `j${i}`);

  /** Run `polls` claimNext calls and return how many times each candidate index
   *  was the FIRST one attempted. */
  async function firstAttemptHistogram(
    rng: () => number,
    polls: number,
  ): Promise<number[]> {
    const firstAttempts: string[] = [];
    let sawThisCall = false;
    const claim: JobClaimClient = {
      async claimJob(jobId, workerId): Promise<ClaimResult> {
        if (!sawThisCall) {
          firstAttempts.push(jobId);
          sawThisCall = true;
        }
        return {
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        };
      },
      renewLease: vi.fn(async (): Promise<RenewResult> => ({ renewed: false })),
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({ released: false }),
      ),
    };
    const q = createFleetQueueClient({
      pb: makeOrderedPb(PAGE_IDS),
      claim,
      logger,
      rng,
    });
    for (let i = 0; i < polls; i++) {
      sawThisCall = false;
      await q.claimNext(`w${i % 6}`, 30);
    }
    const hist = new Array(PAGE_IDS.length).fill(0);
    for (const id of firstAttempts) {
      hist[PAGE_IDS.indexOf(id)] += 1;
    }
    return hist;
  }

  it("RED (contrast): head-first order makes EVERY poll attack the same head row (index 0)", async () => {
    // IDENTITY_ORDER_RNG drives the REAL claimNext in head-first (no-shuffle)
    // order: the herd concentrates entirely on candidate index 0 every poll —
    // the exact thundering-herd that compounds into the claim skew.
    const hist = await firstAttemptHistogram(IDENTITY_ORDER_RNG, 600);
    // 100% of first-attempts landed on the head; every other slot got zero.
    expect(hist[0]).toBe(600);
    expect(hist.slice(1).every((c) => c === 0)).toBe(true);
  });

  it("GREEN: shuffled order spreads first-attempts ~uniformly across the page (herd dispersed)", async () => {
    const polls = 600;
    const hist = await firstAttemptHistogram(mulberry32(98765), polls);
    const expectedPerSlot = polls / PAGE_IDS.length; // 50
    // Every candidate slot gets a meaningful share of first-attempts — no single
    // head row absorbs the herd. A uniform shuffle keeps each slot within a loose
    // band of the expected count, and the head (index 0) is NOT a hot outlier.
    for (const count of hist) {
      expect(count).toBeGreaterThan(expectedPerSlot * 0.4);
      expect(count).toBeLessThan(expectedPerSlot * 1.6);
    }
    const max = Math.max(...hist);
    const mean = polls / PAGE_IDS.length;
    expect(max / mean).toBeLessThan(1.6);
  });
});

describe("FleetQueueClient — FAMILY FAIRNESS (backlogged families must not starve)", () => {
  // ── ROOT CAUSE (verified in prod + staging) ─────────────────────────────────
  // claimNext listed ONE global pending page (the oldest CLAIM_CANDIDATE_PAGE
  // rows). With a persistent backlog from the high-frequency families (d4 + d5
  // tick every 15min ≈ ~180 jobs/hr against 2 serial browser workers), the
  // oldest-50 page is permanently saturated by those families — a low-frequency
  // family's jobs (e2e-demos, hourly) NEVER enter the candidate page and are
  // NEVER claimed. Prod: all 18 e2e-demos jobs stuck pending forever behind a
  // 137-job backlog; staging: 3,734 pending with the oldest 22h old.
  //
  // ── THE FIX (what these tests pin) ──────────────────────────────────────────
  // claimNext now discovers the DISTINCT families present in pending (oldest
  // first) and tries them in ROTATION (round-robin across calls, resuming after
  // the last family this client claimed), listing a PER-FAMILY candidate page
  // for each. Every discovered family is attempted before claimNext gives up,
  // so no family can starve while any of its jobs are claimable. The CAS
  // exactly-one-winner semantics are untouched — only the candidate SELECTION
  // changed.

  // probe_key → family extraction comes from the PRODUCTION helper
  // (`probeKeyFamily` in contracts.ts) rather than a local re-implementation,
  // so these tests can never drift from the family rule the queue actually
  // partitions on.

  /** A JobRow carrying PB's system `created` column (the paging sort key). */
  interface CreatedJobRow extends JobRow {
    created: string;
  }

  /**
   * A PAGING-FAITHFUL fake pb: unlike `makeFakePb` (which ignores `perPage`),
   * this fake honors the parts of the PB list API the fairness fix depends
   * on — the shared `status`/`probe_key` clause matcher (`rowMatchesFilter`),
   * `created`/`lease_expires_at` ascending sorts, and `perPage` truncation —
   * so the production starvation (oldest-50 page saturated by one family) is
   * reproduced faithfully.
   */
  function makePagingPb(rows: CreatedJobRow[]): {
    pb: PbClient;
    store: CreatedJobRow[];
    /** Failure injection: `delete` THROWS for any row id in this set (the
     * stale sweep's claim→delete window losing its delete). Mutable so a test
     * can heal the fault between sweeps and watch the retry succeed. */
    deleteFailures: Set<string>;
  } {
    const store = [...rows];
    const deleteFailures = new Set<string>();
    const unsupported = (name: string) => () => {
      throw new Error(`paging-pb: ${name} not implemented`);
    };
    const pb: PbClient = {
      async list<T>(
        _collection: string,
        opts: ListOpts = {},
      ): Promise<ListResult<T>> {
        let items = store.filter((r) => rowMatchesFilter(r, opts.filter));
        // Honor the sort DIRECTION too (PB's `-` prefix = descending): a
        // fake that silently sorted ascending under a `-created` sort would
        // vacuously pass any newest-first expectation.
        const desc = opts.sort?.startsWith("-") ?? false;
        const sortKey = desc ? opts.sort!.slice(1) : opts.sort;
        if (sortKey && sortKey.includes("lease_expires_at")) {
          // PB ascending date sort; empty/null dates sort first (and a
          // null/empty lease counts as expired — leaseExpired(null) === true —
          // so "nulls first" is exactly the expired-first semantics).
          items = [...items].sort((a, b) =>
            String(a.lease_expires_at ?? "").localeCompare(
              String(b.lease_expires_at ?? ""),
            ),
          );
        } else if (sortKey && sortKey.includes("created")) {
          items = [...items].sort((a, b) => a.created.localeCompare(b.created));
        } else if (sortKey) {
          // An unmodeled sort key used to fall through UNSORTED — a test
          // depending on it would pass vacuously on insertion order. Throw,
          // matching the fakes' unsupported-method philosophy.
          throw new Error(
            `paging-pb: unmodeled sort key "${sortKey}" — only created/lease_expires_at are honored`,
          );
        }
        if (desc) items.reverse();
        const totalItems = items.length;
        if (opts.perPage !== undefined) {
          // Honor `page` (1-based) the way PB does — the stale drain advances
          // past a full page of rows it could not act on.
          const page = opts.page ?? 1;
          items = items.slice((page - 1) * opts.perPage, page * opts.perPage);
        }
        return {
          page: opts.page ?? 1,
          perPage: opts.perPage ?? items.length,
          // Honest totalPages (PB computes it from the REAL total), -1 under
          // skipTotal like totalItems.
          totalPages:
            opts.skipTotal === true
              ? -1
              : opts.perPage !== undefined
                ? Math.max(1, Math.ceil(totalItems / opts.perPage))
                : 1,
          // Faithful to PB: skipTotal returns -1, never a real count the
          // production code did not ask for (fail-open hole).
          totalItems: opts.skipTotal === true ? -1 : totalItems,
          items: items as unknown as T[],
        };
      },
      getOne: unsupported("getOne") as PbClient["getOne"],
      getFirst: unsupported("getFirst") as PbClient["getFirst"],
      create: unsupported("create") as PbClient["create"],
      update: unsupported("update") as PbClient["update"],
      upsertByField: unsupported("upsertByField") as PbClient["upsertByField"],
      async delete(_collection: string, id: string): Promise<void> {
        if (deleteFailures.has(id)) {
          throw new Error(`paging-pb: injected delete failure for ${id}`);
        }
        const idx = store.findIndex((r) => r.id === id);
        if (idx === -1) throw new Error(`paging-pb: delete of missing ${id}`);
        store.splice(idx, 1);
      },
      deleteByFilter: unsupported(
        "deleteByFilter",
      ) as PbClient["deleteByFilter"],
      health: unsupported("health") as PbClient["health"],
      createBackup: unsupported("createBackup") as PbClient["createBackup"],
      downloadBackup: unsupported(
        "downloadBackup",
      ) as PbClient["downloadBackup"],
      deleteBackup: unsupported("deleteBackup") as PbClient["deleteBackup"],
    };
    return { pb, store, deleteFailures };
  }

  /** A store-mutating CAS fake: exactly-one-winner over the shared store. */
  function makeStoreClaim(
    store: CreatedJobRow[],
    opts?: { loseFor?: (row: CreatedJobRow) => boolean },
  ): JobClaimClient {
    return {
      async claimJob(jobId, workerId): Promise<ClaimResult> {
        const row = store.find((r) => r.id === jobId);
        if (!row || row.status !== "pending") return { won: false };
        if (opts?.loseFor?.(row)) return { won: false };
        row.status = "claimed";
        row.claimed_by = workerId;
        row.version += 1;
        return { won: true, job: { ...row } };
      },
      renewLease: vi.fn(async (): Promise<RenewResult> => ({ renewed: false })),
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({ released: false }),
      ),
    };
  }

  /** Seed: 60 old d4 jobs (oldest-50 page saturators) + 18 newer e2e-demos. */
  function starvedStore(): CreatedJobRow[] {
    const t0 = Date.parse("2026-06-04T00:00:00.000Z");
    const rows: CreatedJobRow[] = [];
    for (let i = 0; i < 60; i++) {
      const probeKey = `d4:svc-${String(i).padStart(2, "0")}`;
      rows.push({
        ...jobView({ id: `d4-${i}`, probe_key: probeKey }),
        payload: samplePayload({ probeKey, serviceSlug: `svc-${i}` }),
        created: new Date(t0 + i * 1000).toISOString(),
      });
    }
    for (let i = 0; i < 18; i++) {
      const probeKey = `e2e-demos:svc-${String(i).padStart(2, "0")}`;
      rows.push({
        ...jobView({ id: `demos-${i}`, probe_key: probeKey }),
        payload: samplePayload({ probeKey, serviceSlug: `svc-${i}` }),
        created: new Date(t0 + 3_600_000 + i * 1000).toISOString(),
      });
    }
    return rows;
  }

  it("makePagingPb throws on an unmodeled sort key instead of silently not sorting", async () => {
    // The paging fake honors only `created` / `lease_expires_at` (± the `-`
    // prefix). Any other sort key used to fall through UNSORTED — a test
    // depending on e.g. a `version` sort would pass vacuously on insertion
    // order. Unmodeled sorts must throw, matching the fakes' philosophy.
    const t0 = Date.parse("2026-06-04T00:00:00.000Z");
    const { pb } = makePagingPb([
      {
        ...jobView({ id: "j1", probe_key: "d6:a" }),
        payload: samplePayload(),
        created: new Date(t0).toISOString(),
      },
    ]);
    await expect(
      pb.list("probe_jobs", { filter: 'status = "pending"', sort: "version" }),
    ).rejects.toThrow(/unmodeled sort key "version"/);
    // The modeled keys still work, both directions.
    await expect(
      pb.list("probe_jobs", { sort: "created" }),
    ).resolves.toBeTruthy();
    await expect(
      pb.list("probe_jobs", { sort: "-created" }),
    ).resolves.toBeTruthy();
  });

  it("claims a low-frequency family's jobs even when an older backlog saturates the candidate page (round-robin across families)", async () => {
    const { pb, store } = makePagingPb(starvedStore());
    const claim = makeStoreClaim(store);
    const q = createFleetQueueClient({ pb, claim, logger });

    const claimedFamilies: string[] = [];
    for (let i = 0; i < 6; i++) {
      const c = await q.claimNext("w1", 30);
      expect(c.claimed).toBe(true);
      claimedFamilies.push(probeKeyFamily(c.lease!.job.probe_key));
    }

    // The e2e-demos jobs sit ENTIRELY outside the oldest-50 global page (60
    // older d4 rows precede them) — head-of-queue paging never claims them.
    expect(claimedFamilies).toContain("e2e-demos");
    // Round-robin: while BOTH families have pending jobs, consecutive claims
    // alternate families instead of draining the older family first.
    expect(new Set(claimedFamilies.slice(0, 2))).toEqual(
      new Set(["d4", "e2e-demos"]),
    );
    expect(new Set(claimedFamilies.slice(2, 4))).toEqual(
      new Set(["d4", "e2e-demos"]),
    );
  });

  it("tries EVERY pending family before reporting not-claimed (peer contention on one family cannot starve the rest)", async () => {
    const { pb, store } = makePagingPb(starvedStore());
    // Peers win every d4 CAS race; only the e2e-demos family is winnable.
    const claim = makeStoreClaim(store, {
      loseFor: (row) => row.probe_key.startsWith("d4:"),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const c = await q.claimNext("w1", 30);

    expect(c.claimed).toBe(true);
    expect(probeKeyFamily(c.lease!.job.probe_key)).toBe("e2e-demos");
  });

  it("countPendingForFamily counts that family's NON-TERMINAL rows — claimed/running gate the family too (producer backlog gate)", async () => {
    // The gate bounds CONCURRENT RUNS per family, not just unclaimed batches:
    // a batch that has been claimed (or is running) is still in flight, and a
    // scheduled tick that enqueues a fresh batch on top of it doubles the
    // family's concurrency. Only TERMINAL rows (done/failed) stop gating.
    const t0 = Date.parse("2026-06-04T00:00:00.000Z");
    const rows: CreatedJobRow[] = [
      // Two pending e2e-demos rows (the classic countable backlog)...
      {
        ...jobView({ id: "demos-0", probe_key: "e2e-demos:a" }),
        payload: samplePayload({ probeKey: "e2e-demos:a" }),
        created: new Date(t0).toISOString(),
      },
      {
        ...jobView({ id: "demos-1", probe_key: "e2e-demos:b" }),
        payload: samplePayload({ probeKey: "e2e-demos:b" }),
        created: new Date(t0 + 1000).toISOString(),
      },
      // ...one CLAIMED e2e-demos row (in flight — MUST gate)...
      {
        ...jobView({
          id: "demos-2",
          probe_key: "e2e-demos:c",
          status: "claimed",
          claimed_by: "w9",
        }),
        payload: samplePayload({ probeKey: "e2e-demos:c" }),
        created: new Date(t0 + 2000).toISOString(),
      },
      // ...one RUNNING e2e-demos row (in flight — MUST gate)...
      {
        ...jobView({
          id: "demos-3",
          probe_key: "e2e-demos:d",
          status: "running",
          claimed_by: "w9",
        }),
        payload: samplePayload({ probeKey: "e2e-demos:d" }),
        created: new Date(t0 + 2500).toISOString(),
      },
      // ...one TERMINAL e2e-demos row (finished — must NOT count)...
      {
        ...jobView({
          id: "demos-4",
          probe_key: "e2e-demos:e",
          status: "done",
        }),
        payload: samplePayload({ probeKey: "e2e-demos:e" }),
        created: new Date(t0 + 2750).toISOString(),
      },
      // ...and a pending row from a DIFFERENT family (must not count).
      {
        ...jobView({ id: "d4-0", probe_key: "d4:x" }),
        payload: samplePayload({ probeKey: "d4:x" }),
        created: new Date(t0 + 3000).toISOString(),
      },
    ];
    const { pb, store } = makePagingPb(rows);
    const q = createFleetQueueClient({
      pb,
      claim: makeStoreClaim(store),
      logger,
    });

    // pending(2) + claimed(1) + running(1); the done row is invisible.
    expect(await q.countPendingForFamily("e2e-demos")).toBe(4);
    expect(await q.countPendingForFamily("d4")).toBe(1);
    expect(await q.countPendingForFamily("d6")).toBe(0);
  });

  it("countPendingForFamily gates a family whose batch is claimed-but-running with ZERO pending rows", async () => {
    // The producer regression this pins: family's whole batch is claimed (no
    // pending rows left) — a fresh scheduled batch on top would double the
    // family's concurrent runs, so the count must still be non-zero.
    const t0 = Date.parse("2026-06-04T00:00:00.000Z");
    const { pb, store } = makePagingPb([
      {
        ...jobView({
          id: "demos-0",
          probe_key: "e2e-demos:a",
          status: "running",
          claimed_by: "w1",
        }),
        payload: samplePayload({ probeKey: "e2e-demos:a" }),
        created: new Date(t0).toISOString(),
      },
    ]);
    const q = createFleetQueueClient({
      pb,
      claim: makeStoreClaim(store),
      logger,
    });

    expect(await q.countPendingForFamily("e2e-demos")).toBe(1);
  });

  it("warns when family discovery hits the MAX_PENDING_FAMILIES bound with families still hidden (17 families)", async () => {
    // The discovery loop is bounded at 16 distinct families; tripping the
    // bound used to be SILENT — the 17th family simply never entered the
    // rotation, i.e. exactly the starvation class fairness exists to prevent,
    // with zero observability. Mirror the sweep's truncation warn.
    const t0 = Date.parse("2026-06-04T00:00:00.000Z");
    const rows = Array.from({ length: 17 }, (_, i) => {
      const probeKey = `f${String(i).padStart(2, "0")}:svc`;
      return {
        ...jobView({ id: `r${i}`, probe_key: probeKey }),
        payload: samplePayload({ probeKey }),
        created: new Date(t0 + i * 1000).toISOString(),
      };
    });
    const { pb, store } = makePagingPb(rows);
    const q = createFleetQueueClient({
      pb,
      claim: makeStoreClaim(store),
      logger,
    });

    const claimed = await q.claimNext("w1", 30);

    expect(claimed.claimed).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.family-discovery-truncated",
      expect.objectContaining({
        maxFamilies: 16,
        // The 17th-oldest family is the first one the bound hid.
        nextProbeKey: "f16:svc",
        // ...and it is a genuinely claimable (clause-safe) family.
        nextFamilyClauseSafe: true,
      }),
    );
  });

  it("the truncation warn does not overclaim a hidden family when the head at the bound is clause-unsafe garbage", async () => {
    // The head row AT the truncation index can itself be clause-unsafe
    // garbage (an empty/backslash family) — discovery would never have
    // CLAIMED it, only excluded it by row id. A warn that flatly announces
    // a hidden family for it overclaims; thread the head's clause-safety so
    // the operator can tell a starved REAL family from unclaimable junk.
    const t0 = Date.parse("2026-06-04T00:00:00.000Z");
    const rows = Array.from({ length: 16 }, (_, i) => {
      const probeKey = `f${String(i).padStart(2, "0")}:svc`;
      return {
        ...jobView({ id: `r${i}`, probe_key: probeKey }),
        payload: samplePayload({ probeKey }),
        created: new Date(t0 + i * 1000).toISOString(),
      };
    });
    // The 17th (youngest) pending row carries an empty probe_key — the
    // clause-unsafe empty family.
    rows.push({
      ...jobView({ id: "garbage", probe_key: "" }),
      payload: samplePayload(),
      created: new Date(t0 + 17_000).toISOString(),
    });
    const { pb, store } = makePagingPb(rows);
    const q = createFleetQueueClient({
      pb,
      claim: makeStoreClaim(store),
      logger,
    });

    const claimed = await q.claimNext("w1", 30);

    expect(claimed.claimed).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.family-discovery-truncated",
      expect.objectContaining({
        maxFamilies: 16,
        nextProbeKey: "",
        nextFamilyClauseSafe: false,
      }),
    );
  });

  it("escapes LIKE wildcards in family clauses — a '%' family must not occlude other families from discovery", async () => {
    // PB's `~`/`!~` build SQL `LIKE ... ESCAPE '\\'` (PocketBase 0.22
    // tools/search/filter.go), so `\\%`/`\\_` are LITERAL chars — escapable.
    // Unescaped, a family like "d%" makes the discovery EXCLUSION leg
    // `probe_key !~ "d%:%"` glob-match d6:/d4: keys too, hiding those
    // families from discovery while "d%" rows exist (starvation), and makes
    // the inclusion/count legs over-match symmetrically.
    const t0 = Date.parse("2026-06-04T00:00:00.000Z");
    const mk = (id: string, probeKey: string, offsetMs: number) => ({
      ...jobView({ id, probe_key: probeKey }),
      payload: samplePayload({ probeKey }),
      created: new Date(t0 + offsetMs).toISOString(),
    });
    const { pb, store } = makePagingPb([
      mk("weird-a", "d%:a", 0),
      mk("weird-b", "d%:b", 1000),
      mk("normal", "d6:y", 2000),
    ]);
    const q = createFleetQueueClient({
      pb,
      claim: makeStoreClaim(store),
      logger,
    });

    // The count leg must not over-match: exactly the two literal d% rows.
    expect(await q.countPendingForFamily("d%")).toBe(2);
    expect(await q.countPendingForFamily("d6")).toBe(1);

    // Round-robin across BOTH discovered families: with the unescaped
    // exclusion leg, d6 is never discovered while d% rows exist and the
    // first two claims would both come from d% (d6 starved).
    const claimedFamilies: string[] = [];
    for (let i = 0; i < 2; i++) {
      const c = await q.claimNext("w1", 30);
      expect(c.claimed).toBe(true);
      claimedFamilies.push(probeKeyFamily(c.lease!.job.probe_key));
    }
    expect(new Set(claimedFamilies)).toEqual(new Set(["d%", "d6"]));
  });

  it("matches a whole-key (leading-colon) family by EQUALITY only — ':foo' must not fold ':foo:bar' into its clauses", async () => {
    // probeKeyFamily treats a leading-colon key as its OWN family (the whole
    // key), so family values can themselves contain colons. Expanding such a
    // family with the `<family>:%` LIKE leg breaks the partition both ways:
    // the inclusion/count legs for ":foo" would also match ":foo:bar" (a
    // DIFFERENT family), and the discovery EXCLUSION leg would hide
    // ":foo:bar" from rotation while ":foo" rows exist (starvation). See the
    // equality-only invariant pinned on probeKeyFamily.
    const t0 = Date.parse("2026-06-04T00:00:00.000Z");
    const mk = (id: string, probeKey: string, offsetMs: number) => ({
      ...jobView({ id, probe_key: probeKey }),
      payload: samplePayload({ probeKey }),
      created: new Date(t0 + offsetMs).toISOString(),
    });
    const { pb, store } = makePagingPb([
      mk("colon-a", ":foo", 0),
      mk("colon-b", ":foo:bar", 1000),
    ]);
    const q = createFleetQueueClient({
      pb,
      claim: makeStoreClaim(store),
      logger,
    });

    // The count leg must partition exactly like probeKeyFamily: each
    // whole-key family counts ONLY its own row.
    expect(await q.countPendingForFamily(":foo")).toBe(1);
    expect(await q.countPendingForFamily(":foo:bar")).toBe(1);

    // Round-robin across BOTH whole-key families: with the LIKE leg in the
    // exclusion clause, ":foo:bar" is never discovered while ":foo" rows
    // exist, and the inclusion leg over-claims it under ":foo".
    const claimedFamilies: string[] = [];
    for (let i = 0; i < 2; i++) {
      const c = await q.claimNext("w1", 30);
      expect(c.claimed).toBe(true);
      claimedFamilies.push(probeKeyFamily(c.lease!.job.probe_key));
    }
    expect(new Set(claimedFamilies)).toEqual(new Set([":foo", ":foo:bar"]));
  });

  it("skips a family containing a backslash from clause building (charset guard, with a warn)", async () => {
    // The equality legs double `\` (quoted-literal escaping) while the LIKE
    // legs' fexpr verification covers only `%`/`_` — the two contracts
    // cannot both hold for a backslash, so rather than emit a filter with
    // unverified semantics, clause builders refuse backslash families:
    // probe keys are slugs in practice, so such a family is garbage input.
    const t0 = Date.parse("2026-06-04T00:00:00.000Z");
    const { pb, store } = makePagingPb([
      // Normal family first (oldest) so discovery still yields it.
      {
        ...jobView({ id: "ok-0", probe_key: "d6:y" }),
        payload: samplePayload({ probeKey: "d6:y" }),
        created: new Date(t0).toISOString(),
      },
      {
        ...jobView({ id: "weird-0", probe_key: "d\\:a" }),
        payload: samplePayload({ probeKey: "d\\:a" }),
        created: new Date(t0 + 1000).toISOString(),
      },
    ]);
    const q = createFleetQueueClient({
      pb,
      claim: makeStoreClaim(store),
      logger,
    });

    // The count leg refuses the unsafe family outright (0 + warn) instead
    // of emitting an unverified filter.
    expect(await q.countPendingForFamily("d\\")).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.family-clause-unsafe",
      expect.objectContaining({ family: "d\\" }),
    );

    // Discovery still rotates the families found BEFORE the unsafe one; the
    // claim drains the safe family and reports the unsafe one via the warn.
    const c = await q.claimNext("w1", 30);
    expect(c.claimed).toBe(true);
    expect(c.lease?.job.id).toBe("ok-0");
  });

  it("an unsafe-family row must not starve YOUNGER families — excluded BY ID, discovery continues (G1f)", async () => {
    // Discovery used to BREAK at the first clause-unsafe family (no safe
    // family-exclusion clause exists for it), which starved EVERY younger
    // family behind the offending row for as long as it sat in pending — up
    // to its 3h stale window. The row itself needs no family-charset
    // semantics to exclude: `id != "<rowId>"` (PB system ids are
    // generated alphanumerics) lets discovery CONTINUE past it.
    const t0 = Date.parse("2026-06-04T00:00:00.000Z");
    const { pb, store } = makePagingPb([
      // The unsafe row is the OLDEST — under the old break it occluded
      // everything younger.
      {
        ...jobView({ id: "weird-0", probe_key: "d\\:a" }),
        payload: samplePayload({ probeKey: "d\\:a" }),
        created: new Date(t0).toISOString(),
      },
      {
        ...jobView({ id: "ok-0", probe_key: "d6:y" }),
        payload: samplePayload({ probeKey: "d6:y" }),
        created: new Date(t0 + 1000).toISOString(),
      },
    ]);
    const claim = makeStoreClaim(store);
    const claimJobSpy = vi.spyOn(claim, "claimJob");
    const q = createFleetQueueClient({ pb, claim, logger });

    const c = await q.claimNext("w1", 30);

    // The younger family is still discovered and claimed…
    expect(c.claimed).toBe(true);
    expect(c.lease?.job.id).toBe("ok-0");
    // …the unsafe row is skipped from claiming entirely (warned, not tried).
    expect(claimJobSpy).not.toHaveBeenCalledWith(
      "weird-0",
      expect.anything(),
      expect.anything(),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.family-clause-unsafe",
      expect.objectContaining({ family: "d\\", probeKey: "d\\:a" }),
    );
  });

  it("the EMPTY family's row is skipped by id while leading-colon families stay discoverable (G1c × G1f)", async () => {
    // COMPOSITION: the empty family (G1c) is clause-unsafe AND its
    // would-have-been exclusion clause is the one that hid all leading-colon
    // families. With the by-id exclusion (G1f) the ":foo" whole-key family
    // behind an empty-probe_key row is still discovered and claimed under
    // its OWN family — never folded under "".
    const t0 = Date.parse("2026-06-04T00:00:00.000Z");
    const { pb, store } = makePagingPb([
      {
        ...jobView({ id: "empty-0", probe_key: "" }),
        payload: samplePayload(),
        created: new Date(t0).toISOString(),
      },
      {
        ...jobView({ id: "colon-0", probe_key: ":foo" }),
        payload: samplePayload({ probeKey: ":foo" }),
        created: new Date(t0 + 1000).toISOString(),
      },
    ]);
    const claim = makeStoreClaim(store);
    const claimJobSpy = vi.spyOn(claim, "claimJob");
    const q = createFleetQueueClient({ pb, claim, logger });

    const c = await q.claimNext("w1", 30);

    expect(c.claimed).toBe(true);
    expect(c.lease?.job.id).toBe("colon-0");
    expect(claimJobSpy).not.toHaveBeenCalledWith(
      "empty-0",
      expect.anything(),
      expect.anything(),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.family-clause-unsafe",
      expect.objectContaining({ family: "" }),
    );
  });

  it("refuses the EMPTY family from clause building (G1c) — its clauses would match every leading-colon key", async () => {
    // probeKeyFamily("") === "" takes the prefix-LIKE leg of the clause
    // builders: familyInclusionClause("") is `(probe_key ~ ":%" ||
    // probe_key = "")` — matching EVERY leading-colon key (cross-family
    // over-claim/over-count) — and familyExclusionClause("") hides ALL
    // leading-colon families from discovery. The empty family must be
    // clause-unsafe exactly like the backslash class: count refuses with 0 +
    // warn instead of emitting the over-matching filter.
    const t0 = Date.parse("2026-06-04T00:00:00.000Z");
    const { pb, store } = makePagingPb([
      {
        ...jobView({ id: "colon-0", probe_key: ":foo" }),
        payload: samplePayload({ probeKey: ":foo" }),
        created: new Date(t0).toISOString(),
      },
    ]);
    const q = createFleetQueueClient({
      pb,
      claim: makeStoreClaim(store),
      logger,
    });

    // The over-matching clause would count the ":foo" row under family "".
    expect(await q.countPendingForFamily("")).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.family-clause-unsafe",
      expect.objectContaining({ family: "" }),
    );
    // The ":foo" row still counts under its OWN (whole-key) family.
    expect(await q.countPendingForFamily(":foo")).toBe(1);
  });

  it("countPendingForFamily THROWS on a non-count totalItems instead of returning the poisoned value", async () => {
    // skipTotal:false is requested, but a backend/client drift that still
    // returns -1 (or garbage) must not reach the producer's backlog gate —
    // -1 is never above the threshold, so the gate would silently fail
    // open. Fail loud at the boundary.
    const t0 = Date.parse("2026-06-04T00:00:00.000Z");
    const { pb, store } = makePagingPb([
      {
        ...jobView({ id: "d4-0", probe_key: "d4:x" }),
        payload: samplePayload({ probeKey: "d4:x" }),
        created: new Date(t0).toISOString(),
      },
    ]);
    const realList = pb.list.bind(pb);
    pb.list = vi.fn(async (collection: string, opts?: ListOpts) => {
      const page = await realList(collection, opts);
      return { ...page, totalItems: -1 };
    }) as PbClient["list"];
    const q = createFleetQueueClient({
      pb,
      claim: makeStoreClaim(store),
      logger,
    });

    await expect(q.countPendingForFamily("d4")).rejects.toThrow(
      /non-count totalItems/i,
    );
    // The refusal is a DEDICATED EXPORTED CLASS, not just message text: the
    // producer's backlog gate discriminates this fail-closed class via
    // `instanceof` (message-substring matching silently flipped the gate
    // fail-closed → fail-open on any message drift).
    await expect(q.countPendingForFamily("d4")).rejects.toBeInstanceOf(
      PoisonedBacklogCountError,
    );
  });

  it("countPendingForFamily explicitly requests totals (skipTotal: false) — the backlog gate must not fail open", async () => {
    // The gate reads totalItems off a perPage=1 list. If totals are skipped
    // (PB client default elsewhere in this file is skipTotal: true) PB
    // returns totalItems: -1 — and -1 is never above the producer's backlog
    // threshold, so the gate would silently FAIL OPEN and enqueue a fresh
    // batch on top of an existing backlog. Pin the explicit request.
    const t0 = Date.parse("2026-06-04T00:00:00.000Z");
    const { pb, store } = makePagingPb([
      {
        ...jobView({ id: "d4-0", probe_key: "d4:x" }),
        payload: samplePayload({ probeKey: "d4:x" }),
        created: new Date(t0).toISOString(),
      },
    ]);
    const captured: ListOpts[] = [];
    const realList = pb.list.bind(pb);
    pb.list = vi.fn(async (collection: string, opts?: ListOpts) => {
      captured.push(opts ?? {});
      return realList(collection, opts);
    }) as PbClient["list"];
    const q = createFleetQueueClient({
      pb,
      claim: makeStoreClaim(store),
      logger,
    });

    expect(await q.countPendingForFamily("d4")).toBe(1);
    expect(captured).toHaveLength(1);
    expect(captured[0].skipTotal).toBe(false);
  });

  it("drains the remaining family once the other is exhausted", async () => {
    const t0 = Date.parse("2026-06-04T00:00:00.000Z");
    const rows: CreatedJobRow[] = [
      {
        ...jobView({ id: "d4-0", probe_key: "d4:only" }),
        payload: samplePayload({ probeKey: "d4:only" }),
        created: new Date(t0).toISOString(),
      },
      {
        ...jobView({ id: "demos-0", probe_key: "e2e-demos:a" }),
        payload: samplePayload({ probeKey: "e2e-demos:a" }),
        created: new Date(t0 + 1000).toISOString(),
      },
      {
        ...jobView({ id: "demos-1", probe_key: "e2e-demos:b" }),
        payload: samplePayload({ probeKey: "e2e-demos:b" }),
        created: new Date(t0 + 2000).toISOString(),
      },
    ];
    const { pb, store } = makePagingPb(rows);
    const claim = makeStoreClaim(store);
    const q = createFleetQueueClient({ pb, claim, logger });

    const claimedIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = await q.claimNext("w1", 30);
      expect(c.claimed).toBe(true);
      claimedIds.push(c.lease!.job.id);
    }
    // All three jobs are claimed across families; nothing is stranded.
    expect(new Set(claimedIds)).toEqual(
      new Set(["d4-0", "demos-0", "demos-1"]),
    );
    // The queue is now empty.
    const done = await q.claimNext("w1", 30);
    expect(done.claimed).toBe(false);
  });

  describe("sweepExpired — STALE-PENDING EXPIRY (structural backlog drain)", () => {
    // sweepExpired only reclaimed claimed/running leases — a pending row had
    // NO terminal path, so an accumulated backlog (staging: 3,734 pending,
    // oldest 22h) could only drain through 2 serial workers and effectively
    // never did. The sweep now ALSO expires pending jobs older than
    // expiryPeriods × their family's production period (the job's data is
    // stale — its family has long since enqueued fresher batches): each stale
    // row is first CLAIMED via the S0 CAS under a synthetic sweeper id (so a
    // racing worker can never lose a row out from under itself) and then
    // DELETED.

    const T = Date.parse("2026-06-04T12:00:00.000Z");
    const HOUR = 60 * 60 * 1000;
    const MIN = 60 * 1000;

    function pendingRow(
      id: string,
      probeKey: string,
      createdMs: number,
    ): CreatedJobRow {
      return {
        ...jobView({ id, probe_key: probeKey }),
        payload: samplePayload({ probeKey }),
        created: new Date(createdMs).toISOString(),
      };
    }

    it("claims-then-deletes pending jobs older than expiryPeriods × the (default) family period", async () => {
      const stale = pendingRow("old", "d6:a", T - 4 * HOUR); // > 3 × 60min
      const fresh = pendingRow("new", "d6:b", T - 10 * MIN);
      const { pb, store } = makePagingPb([stale, fresh]);
      const claimJobCalls: Array<[string, string]> = [];
      const base = makeStoreClaim(store);
      const claim: JobClaimClient = {
        ...base,
        async claimJob(jobId, workerId, leaseSeconds) {
          claimJobCalls.push([jobId, workerId]);
          return base.claimJob(jobId, workerId, leaseSeconds);
        },
      };
      const q = createFleetQueueClient({ pb, claim, logger });

      const sweep = await q.sweepExpired(T);

      expect(sweep.expiredPending).toBe(1);
      // The stale row was CLAIMED first (CAS — never delete a row a worker
      // could be racing for) and then deleted.
      expect(claimJobCalls.map(([id]) => id)).toEqual(["old"]);
      expect(store.find((r) => r.id === "old")).toBeUndefined();
      // The fresh row is untouched and still claimable.
      expect(store.find((r) => r.id === "new")?.status).toBe("pending");
      // No comm error for an expired-pending row — it never ran.
      expect(sweep.commErrors).toHaveLength(0);
    });

    it("does NOT delete a stale pending row whose claim is lost to a racing worker", async () => {
      const stale = pendingRow("old", "d6:a", T - 4 * HOUR);
      const { pb, store } = makePagingPb([stale]);
      // A worker wins every CAS race — the sweeper must back off.
      const claim = makeStoreClaim(store, { loseFor: () => true });
      const q = createFleetQueueClient({ pb, claim, logger });

      const sweep = await q.sweepExpired(T);

      expect(sweep.expiredPending).toBe(0);
      expect(store.find((r) => r.id === "old")?.status).toBe("pending");
    });

    it("honors per-family periods from stalePending.familyPeriodsMs", async () => {
      // 50min-old rows: stale for d4 (3 × 15min = 45min) but NOT for d6
      // (default 3 × 60min = 3h).
      const d4 = pendingRow("d4-old", "d4:a", T - 50 * MIN);
      const d6 = pendingRow("d6-young", "d6:a", T - 50 * MIN);
      const { pb, store } = makePagingPb([d4, d6]);
      const q = createFleetQueueClient({
        pb,
        claim: makeStoreClaim(store),
        logger,
        stalePending: { familyPeriodsMs: { d4: 15 * MIN } },
      });

      const sweep = await q.sweepExpired(T);

      expect(sweep.expiredPending).toBe(1);
      expect(store.find((r) => r.id === "d4-old")).toBeUndefined();
      expect(store.find((r) => r.id === "d6-young")?.status).toBe("pending");
    });

    it("is disabled when expiryPeriods <= 0", async () => {
      const stale = pendingRow("old", "d6:a", T - 48 * HOUR);
      const { pb, store } = makePagingPb([stale]);
      const q = createFleetQueueClient({
        pb,
        claim: makeStoreClaim(store),
        logger,
        stalePending: { expiryPeriods: 0 },
      });

      const sweep = await q.sweepExpired(T);

      expect(sweep.expiredPending).toBe(0);
      expect(store.find((r) => r.id === "old")?.status).toBe("pending");
    });

    it("re-queues a sweeper-claimed row whose delete failed SILENTLY (no comm error) and retries the delete on a later sweep", async () => {
      // When the stale sweep wins the claim but the DELETE fails, the row
      // sits claimed under "stale-pending-sweeper" until its short lease
      // expires. The next lease sweep must NOT treat that like a crashed
      // worker's job: it is stale garbage mid-deletion, so it is re-queued
      // SILENTLY (no `worker-reclaimed-pending` comm error attributed to a
      // non-existent worker, no gray "back in flight" dashboard overlay) and
      // a later stale sweep retries the delete — the self-healing contract.
      const stale = pendingRow("old", "d6:a", T - 4 * HOUR);
      const { pb, store, deleteFailures } = makePagingPb([stale]);
      deleteFailures.add("old");
      const base = makeStoreClaim(store);
      // The lease-phase re-queue needs a REAL releaseJob (makeStoreClaim's
      // default vi.fn refuses): authorize on claimed_by, flip back to pending.
      const claim: JobClaimClient = {
        ...base,
        async releaseJob(jobId, workerId, status): Promise<ReleaseResult> {
          const row = store.find((r) => r.id === jobId);
          if (!row || row.claimed_by !== workerId) return { released: false };
          row.status = status as JobStatus;
          row.claimed_by = "";
          row.lease_expires_at = null;
          row.version += 1;
          return { released: true, job: { ...row } };
        },
      };
      const q = createFleetQueueClient({ pb, claim, logger });
      const debugSpy = vi.spyOn(logger, "debug");

      // Sweep 1: stale phase claims the row, delete FAILS — not counted, not
      // thrown; the row stays briefly claimed by the sweeper.
      const first = await q.sweepExpired(T);
      expect(first.expiredPending).toBe(0);
      expect(first.commErrors).toHaveLength(0);
      expect(store.find((r) => r.id === "old")?.claimed_by).toBe(
        "stale-pending-sweeper",
      );

      // Sweep 2 (the sweeper's lease has expired — the fake CAS leaves
      // lease_expires_at null): the lease phase re-queues the row SILENTLY,
      // and the silent re-queue feeds the grace set — the SAME sweep's stale
      // phase must NOT re-claim it (the retry contract is a LATER sweep), so
      // the row ends this sweep PENDING and unclaimed.
      const second = await q.sweepExpired(T);
      expect(second.commErrors).toHaveLength(0);
      expect(second.reclaimed).toBe(0);
      expect(second.expiredPending).toBe(0);
      expect(
        debugSpy.mock.calls.some(
          ([msg]) => msg === "queue-client.stale-sweeper-retry-requeue",
        ),
      ).toBe(true);
      // Proof the grace applied to the sweeper-retry row: the stale phase saw
      // it pending and SKIPPED it instead of re-claiming it.
      expect(
        debugSpy.mock.calls.some(
          ([msg]) => msg === "queue-client.sweep-stale-grace",
        ),
      ).toBe(true);
      expect(store.find((r) => r.id === "old")?.status).toBe("pending");
      expect(store.find((r) => r.id === "old")?.claimed_by).toBe("");

      // Sweep 3 (delete healed): the row is plain pending now, so the stale
      // phase claims-and-deletes it cleanly — still no comm error anywhere.
      deleteFailures.delete("old");
      const third = await q.sweepExpired(T);
      expect(third.expiredPending).toBe(1);
      expect(third.commErrors).toHaveLength(0);
      expect(store.find((r) => r.id === "old")).toBeUndefined();
      debugSpy.mockRestore();
    });

    it("a claimJob THROW on one row does NOT abort the drain — later rows still expire (per-row containment)", async () => {
      // The first (oldest) stale row claims-and-deletes cleanly; the second
      // row's claim CAS THROWS (e.g. a deterministic 4xx, which job-claim
      // throws loud). The drain used to let it escape to the PHASE wrapper —
      // aborting the WHOLE drain for one sick row (every later stale row
      // unprocessed this sweep). Contain it PER ROW: warn + continue; the
      // third row must still expire in the SAME sweep.
      const ok = pendingRow("old-ok", "d6:a", T - 5 * HOUR);
      const boom = pendingRow("old-boom", "d6:b", T - 4 * HOUR);
      const after = pendingRow("old-after", "d6:c", T - 3.5 * HOUR);
      const { pb, store } = makePagingPb([ok, boom, after]);
      const base = makeStoreClaim(store);
      const claim: JobClaimClient = {
        ...base,
        async claimJob(jobId, workerId, leaseSeconds) {
          if (jobId === "old-boom") throw new Error("cas 400 bad request");
          return base.claimJob(jobId, workerId, leaseSeconds);
        },
      };
      const q = createFleetQueueClient({ pb, claim, logger });

      const sweep = await q.sweepExpired(T);

      // BOTH healthy rows expired — the throw did not abort the drain.
      expect(sweep.expiredPending).toBe(2);
      expect(store.find((r) => r.id === "old-ok")).toBeUndefined();
      expect(store.find((r) => r.id === "old-after")).toBeUndefined();
      expect(store.find((r) => r.id === "old-boom")?.status).toBe("pending");
      expect(logger.warn).toHaveBeenCalledWith(
        "queue-client.sweep-stale-claim-threw",
        expect.objectContaining({
          jobId: "old-boom",
          err: "cas 400 bad request",
        }),
      );
      // Contained per row — the phase wrapper never saw it.
      expect(logger.error).not.toHaveBeenCalledWith(
        "queue-client.sweep-stale-phase-threw",
        expect.anything(),
      );
    });

    it("drains MULTIPLE pages of stale pending rows in ONE sweep (a backlog must not take hours to expire)", async () => {
      // 120 stale rows span 3 candidate pages (perPage 50). A single-page
      // sweep would expire only 50 — against the motivating 3,734-row staging
      // backlog at ~10 sweeps/hour that is ~7.5h of drain. The sweep must
      // loop pages (deletes shift pagination, so re-listing page 1 yields the
      // next batch) until the backlog is gone or the per-sweep cap is hit.
      const rows = Array.from({ length: 120 }, (_, i) =>
        pendingRow(`stale-${i}`, "d6:a", T - 4 * HOUR - i * 1000),
      );
      const { pb, store } = makePagingPb(rows);
      const q = createFleetQueueClient({
        pb,
        claim: makeStoreClaim(store),
        logger,
      });

      const sweep = await q.sweepExpired(T);

      expect(sweep.expiredPending).toBe(120);
      expect(store).toHaveLength(0);
    });

    it("drains expirable fast-family rows occluded behind a FULL page of not-yet-expirable slow-family rows (cross-family occlusion)", async () => {
      // Expiry is PER FAMILY but the drain's sort is absolute `created`: 50
      // OLDER d6 rows (default 3h window — NOT expirable at 1h old) fill page
      // 1, while YOUNGER d4 rows (45min window, 50min old — expirable) sit on
      // page 2. An early `if (passExpired === 0) break` stops at page 1 and
      // strands the d4 rows for the whole sweep — the exact cross-family
      // occlusion class the multi-page drain exists to fix. A full page that
      // produced no claim attempts must ADVANCE to the next page (still
      // bounded by the per-sweep page cap); only a NON-FULL page proves the
      // queue's tail was seen.
      const slow = Array.from({ length: 50 }, (_, i) =>
        pendingRow(`slow-${i}`, "d6:a", T - HOUR - i * 1000),
      );
      const fast = Array.from({ length: 10 }, (_, i) =>
        pendingRow(`fast-${i}`, "d4:a", T - 50 * MIN + i * 1000),
      );
      const { pb, store } = makePagingPb([...slow, ...fast]);
      const q = createFleetQueueClient({
        pb,
        claim: makeStoreClaim(store),
        logger,
        stalePending: { familyPeriodsMs: { d4: 15 * MIN } },
      });

      const sweep = await q.sweepExpired(T);

      // All 10 expirable d4 rows reclaimed in ONE sweep…
      expect(sweep.expiredPending).toBe(10);
      expect(store.filter((r) => r.probe_key.startsWith("d4:"))).toHaveLength(
        0,
      );
      // …and the not-yet-expirable slow family is untouched.
      expect(store).toHaveLength(50);
    });

    it("caps a single sweep at 10 pages (500 rows) so one sweep cannot monopolize the producer tick", async () => {
      const rows = Array.from({ length: 520 }, (_, i) =>
        pendingRow(`stale-${i}`, "d6:a", T - 4 * HOUR - i * 1000),
      );
      const { pb, store } = makePagingPb(rows);
      const q = createFleetQueueClient({
        pb,
        claim: makeStoreClaim(store),
        logger,
      });

      const sweep = await q.sweepExpired(T);

      expect(sweep.expiredPending).toBe(500);
      expect(store).toHaveLength(20);
      // The overflow drains on the NEXT sweep — capped, not stranded.
      const next = await q.sweepExpired(T);
      expect(next.expiredPending).toBe(20);
      expect(store).toHaveLength(0);
    });

    it("terminates a sweep pass that makes no progress (a page of non-expirable rows must not loop)", async () => {
      // A full page of stale rows that all LOSE the CAS race (workers won
      // them): re-listing pending would return rows the sweeper cannot act
      // on... except a lost claim flips the row to "claimed" so it drops out
      // of the pending filter. The truly re-listable no-progress case is
      // unparseable `created` rows — pin that a page of them terminates.
      const rows = Array.from({ length: 50 }, (_, i) => ({
        ...pendingRow(`odd-${i}`, "d6:a", T),
        created: "not-a-date",
      }));
      const { pb, store } = makePagingPb(rows);
      const q = createFleetQueueClient({
        pb,
        claim: makeStoreClaim(store),
        logger,
      });

      const sweep = await q.sweepExpired(T);

      expect(sweep.expiredPending).toBe(0);
      expect(store).toHaveLength(50);
    });

    it("conservatively skips a pending row whose created timestamp is unparseable (delete is destructive)", async () => {
      const garbage = {
        ...pendingRow("odd", "d6:a", T),
        created: "not-a-date",
      };
      const { pb, store } = makePagingPb([garbage]);
      const q = createFleetQueueClient({
        pb,
        claim: makeStoreClaim(store),
        logger,
      });

      const sweep = await q.sweepExpired(T);

      expect(sweep.expiredPending).toBe(0);
      expect(store.find((r) => r.id === "odd")?.status).toBe("pending");
    });

    it("grants one sweep of grace to a row re-queued by the lease phase in the SAME sweep (commError stands; control row still expires)", async () => {
      // A long-claimed row: its lease just expired AND its `created` (the
      // ORIGINAL enqueue time — the lease phase's re-queue does not touch it)
      // already exceeds the stale window. Without the grace, the lease phase
      // re-queues it to pending and emits `worker-reclaimed-pending` ("back in
      // flight"), then the stale-pending phase of the SAME sweepExpired call
      // lists pending fresh, ages it off `created`, and claims-then-deletes
      // it — falsifying the comm error (and orphaning downstream overlay
      // resolution on the deleted row).
      const longClaimed: CreatedJobRow = {
        ...jobView({
          id: "long-claimed",
          probe_key: "d6:a",
          status: "running",
          claimed_by: "worker-dead",
          lease_expires_at: new Date(T - MIN).toISOString(),
        }),
        payload: samplePayload({ probeKey: "d6:a" }),
        created: new Date(T - 4 * HOUR).toISOString(), // > 3 × 60min default
      };
      // Control: a genuinely stale pending row UNTOUCHED by the lease phase
      // must still expire in this same sweep.
      const untouchedStale = pendingRow("untouched-old", "d6:b", T - 4 * HOUR);
      const { pb, store } = makePagingPb([longClaimed, untouchedStale]);
      const base = makeStoreClaim(store);
      const claim: JobClaimClient = {
        ...base,
        // Store-mutating release: the sweeper re-queues on behalf of the dead
        // holder, flipping the row back to pending so the SAME call's fresh
        // pending list (the bug path) actually sees it.
        async releaseJob(jobId, workerId, status): Promise<ReleaseResult> {
          const r = store.find((x) => x.id === jobId);
          if (!r || r.claimed_by !== workerId) return { released: false };
          r.status = status;
          r.claimed_by = "";
          r.version += 1;
          return { released: true, job: { ...r } };
        },
      };
      const q = createFleetQueueClient({ pb, claim, logger });

      const sweep = await q.sweepExpired(T);

      // Lease phase: re-queued and emitted the neutral comm error...
      expect(sweep.reclaimed).toBe(1);
      expect(sweep.commErrors).toHaveLength(1);
      expect(sweep.commErrors[0].kind).toBe("worker-reclaimed-pending");
      expect(sweep.commErrors[0].jobId).toBe("long-claimed");
      // ...and the SAME sweep's stale phase must NOT delete it: one sweep of
      // grace keeps "re-queued to pending" true. If truly stale it ages out
      // on the NEXT sweep.
      expect(store.find((r) => r.id === "long-claimed")?.status).toBe(
        "pending",
      );
      // The control row still expires — the grace is scoped to rows the lease
      // phase re-queued in THIS call, not a blanket stale-phase skip.
      expect(sweep.expiredPending).toBe(1);
      expect(store.find((r) => r.id === "untouched-old")).toBeUndefined();
    });

    it("a re-queued long-runner survives the NEXT sweep (recent lease = stale-age evidence is stale)", async () => {
      // Stale-pending age is anchored on PB `created` and re-queue does NOT
      // re-anchor it. A job that legitimately ran LONGER than its family's
      // expiry window therefore comes back from the lease sweep already
      // "stale": sweep N re-queues it ("back in flight" comm error), the
      // one-sweep grace protects it within sweep N, but sweep N+1's stale
      // phase ages it off the ORIGINAL `created` and claim-deletes it before
      // any plausible re-run — the dashboard permanently shows "re-queued"
      // for silently-discarded work. The fix (no schema change): the hook
      // RETAINS lease_expires_at on a pending re-queue, and the stale phase
      // SKIPS rows whose retained lease is recent (parseable and within
      // now - familyExpiryWindow) — the row was in flight recently, so its
      // pending-age is stale evidence, not abandonment.
      const longRunner: CreatedJobRow = {
        ...jobView({
          id: "long-runner",
          probe_key: "d6:a",
          status: "running",
          claimed_by: "worker-dead",
          lease_expires_at: new Date(T - MIN).toISOString(),
        }),
        payload: samplePayload({ probeKey: "d6:a" }),
        created: new Date(T - 4 * HOUR).toISOString(), // > 3 × 60min default
      };
      const { pb, store } = makePagingPb([longRunner]);
      const base = makeStoreClaim(store);
      const claim: JobClaimClient = {
        ...base,
        // Hook-faithful pending release: drops ownership but RETAINS the
        // (expired) lease as the row's last-in-flight marker — the hook no
        // longer nulls lease_expires_at on re-queue (parity-pinned below).
        async releaseJob(jobId, workerId, status): Promise<ReleaseResult> {
          const r = store.find((x) => x.id === jobId);
          if (!r || r.claimed_by !== workerId) return { released: false };
          r.status = status;
          r.claimed_by = "";
          r.version += 1;
          return { released: true, job: { ...r } };
        },
      };
      const q = createFleetQueueClient({ pb, claim, logger });

      // Sweep 1: lease phase re-queues + emits the comm error; the grace set
      // protects the row within THIS sweep.
      const first = await q.sweepExpired(T);
      expect(first.reclaimed).toBe(1);
      expect(first.commErrors[0]?.jobId).toBe("long-runner");
      expect(first.expiredPending).toBe(0);
      expect(store.find((r) => r.id === "long-runner")?.status).toBe("pending");

      // Sweep 2: the grace set is per-call, so only the recent-lease
      // heuristic stands between the re-queued row and a claim-delete. The
      // row's retained lease (expired 1min ago) is WELL within the 3h family
      // window — it was in flight a minute ago, so it must survive to be
      // re-claimed and actually re-run.
      const second = await q.sweepExpired(T);
      expect(second.expiredPending).toBe(0);
      expect(store.find((r) => r.id === "long-runner")?.status).toBe("pending");

      // CONTROL: once the retained lease itself is OLDER than the family
      // window (no re-claim for a whole window — genuinely abandoned), the
      // stale phase expires the row normally.
      const muchLater = T + 4 * HOUR;
      const third = await q.sweepExpired(muchLater);
      expect(third.expiredPending).toBe(1);
      expect(store.find((r) => r.id === "long-runner")).toBeUndefined();
    });

    it("an UNPARSEABLE lease on a stale-aged orphan below the cap is RE-QUEUED — requeued_at re-anchors so the next sweep does NOT falsify 'back in flight' (layer a)", async () => {
      // COMPOSE HOLE, now closed by requeued_at: the carve-out USED to delete
      // an expired claimed/running row with an unparseable lease, because
      // re-queueing it emitted "back in flight" yet the NEXT sweep's
      // (lease-based) recent-lease protection could not read the junk lease,
      // so the row was claim-deleted off its stale `created` age — falsifying
      // the signal. The reclaimable-leases re-anchor removes the lease from
      // the cross-sweep protection entirely: a re-queued row carries
      // requeued_at, and the next sweep ages it off THAT (genuinely young),
      // not the unparseable lease. So an unparseable-lease orphan below the
      // cap is now RE-CLAIMED (non-lossy) and the signal HOLDS — the lease's
      // parseability no longer matters.
      const junkLease: CreatedJobRow = {
        ...jobView({
          id: "junk-lease",
          probe_key: "d6:a",
          status: "running",
          claimed_by: "worker-dead",
          // Unparseable: leaseExpired(NaN) → expired (never wedge). Its
          // parseability is now irrelevant to the cross-sweep protection.
          lease_expires_at: "not-a-date",
        }),
        payload: samplePayload({ probeKey: "d6:a" }),
        created: new Date(T - 4 * HOUR).toISOString(), // > 3 × 60min window
        reclaim_count: 0,
      };
      const { pb, store } = makePagingPb([junkLease]);
      const sink = { releasedPending: [] as string[] };
      const claim = makeReclaimClaim(store, T, sink);
      const q = createFleetQueueClient({ pb, claim, logger });

      // Sweep 1: RE-CLAIMED (non-lossy), an honest "back in flight" gray.
      const first = await q.sweepExpired(T);
      const row = store.find((r) => r.id === "junk-lease");
      expect(row?.status).toBe("pending");
      expect(sink.releasedPending).toEqual(["junk-lease"]);
      expect(first.commErrors).toHaveLength(1);
      expect(first.commErrors[0].kind).toBe("worker-reclaimed-pending");
      expect(first.reclaimed).toBe(1);
      expect(first.expiredPending).toBe(0);
      expect(row?.requeued_at).toBe(new Date(T).toISOString());

      // Sweep 2 a stale-window later: the row is still pending and still stale
      // by `created`, but YOUNG by requeued_at — so it is NOT claim-deleted.
      // The signal from sweep 1 stands (the unparseable lease never mattered).
      const second = await q.sweepExpired(T + MIN);
      expect(store.find((r) => r.id === "junk-lease")?.status).toBe("pending");
      expect(second.expiredPending).toBe(0);
      expect(second.reclaimed).toBe(0);
    });

    /**
     * Hook-faithful CAS over the paging store for the reclaimable-leases
     * tests: `claimJob` admits pending rows AND expired-lease claimed/running
     * rows (the reclaim safety net), and `releaseJob(..., "pending")` mirrors
     * the fleet-claim.pb.js release CAS — it bumps the durable `reclaim_count`
     * tally and stamps `requeued_at = now` (the stale-age re-anchor). Without
     * those two field writes the reaper's attempt cap and honesty-bind
     * dissolution would not be exercised, so this fake models them exactly as
     * the server does.
     */
    function makeReclaimClaim(
      store: CreatedJobRow[],
      nowMs: number,
      sink?: { releasedPending: string[] },
    ): JobClaimClient {
      return {
        async claimJob(jobId, workerId): Promise<ClaimResult> {
          const r = store.find((x) => x.id === jobId);
          if (!r) return { won: false };
          const wasExpiredSteal =
            ["claimed", "running"].includes(r.status) &&
            leaseExpired(r.lease_expires_at, nowMs);
          const reclaimable = r.status === "pending" || wasExpiredSteal;
          if (!reclaimable) return { won: false };
          r.status = "claimed";
          r.claimed_by = workerId;
          r.version += 1;
          // Mirror the claim CAS: an expired-lease steal bumps the LIFETIME
          // reclaim tally (`reclaim_count`) but does NOT touch the consecutive
          // re-orphan counter (`consecutive_orphan_count`). A plain pending
          // claim bumps neither.
          if (wasExpiredSteal) {
            r.reclaim_count = (r.reclaim_count ?? 0) + 1;
            // consecutive_orphan_count is intentionally NOT bumped here.
          }
          return { won: true, job: { ...r } };
        },
        renewLease: vi.fn(
          async (): Promise<RenewResult> => ({ renewed: false }),
        ),
        async releaseJob(jobId, workerId, status): Promise<ReleaseResult> {
          const r = store.find((x) => x.id === jobId);
          if (!r || r.claimed_by !== workerId) return { released: false };
          if (status === "pending") {
            sink?.releasedPending.push(jobId);
            // Mirror the release CAS: bump BOTH tallies and re-anchor.
            // `reclaim_count` is the lifetime diagnostic; `consecutive_orphan_count`
            // is the cap counter (sweeper re-queue path only).
            r.reclaim_count = (r.reclaim_count ?? 0) + 1;
            r.consecutive_orphan_count = (r.consecutive_orphan_count ?? 0) + 1;
            r.requeued_at = new Date(nowMs).toISOString();
          } else {
            // Terminal release: reset the consecutive counter so a LATER
            // re-orphan starts with a fresh budget. Lifetime tally is NOT reset.
            r.consecutive_orphan_count = 0;
          }
          r.status = status;
          r.claimed_by = "";
          r.version += 1;
          return { released: true, job: { ...r } };
        },
      };
    }

    it("RECLAIM-WINS (layer a): a stale-aged long-expired orphan below the reclaim cap is RE-QUEUED (not dropped) — the abrupt-bounce floor", async () => {
      // RED→GREEN PROOF (proposal §5). A worker died mid-sweep leaving an
      // in-flight (running) row whose lease expired LONGER than the family's
      // stale window AND whose created-age is past that window. TODAY (the
      // long-expired carve-out G1d, pre-fix) this row is claim-DELETED:
      // reclaimed=0, expiredPending=1, the work silently dropped. AFTER the
      // fix reclaim WINS until MAX_RECLAIM_ATTEMPTS: the orphan is re-queued
      // to pending (reclaimed=1, expiredPending=0), its reclaim_count bumped
      // and requeued_at stamped, so it RE-RUNS. The honesty bind is dissolved
      // by requeued_at (see the next-sweep test below), so the "back in
      // flight" comm error is honest.
      const longDead: CreatedJobRow = {
        ...jobView({
          id: "long-dead",
          probe_key: "d6:a",
          status: "running",
          claimed_by: "worker-dead",
          // Lease expired 4h ago — LONGER than the 3h (3 × 60min) window.
          lease_expires_at: new Date(T - 4 * HOUR).toISOString(),
        }),
        payload: samplePayload({ probeKey: "d6:a" }),
        created: new Date(T - 8 * HOUR).toISOString(), // stale-aged
        // Never reclaimed before — below the cap.
        reclaim_count: 0,
      };
      const { pb, store } = makePagingPb([longDead]);
      const sink = { releasedPending: [] as string[] };
      const claim = makeReclaimClaim(store, T, sink);
      const q = createFleetQueueClient({ pb, claim, logger });

      const sweep = await q.sweepExpired(T);

      // RE-CLAIMED, not dropped: the row survives as pending and re-runs.
      const row = store.find((r) => r.id === "long-dead");
      expect(row).toBeDefined();
      expect(row?.status).toBe("pending");
      expect(sink.releasedPending).toContain("long-dead");
      // Telemetry flips: the orphan is reclaimed, NOT expired-deleted.
      expect(sweep.reclaimed).toBe(1);
      expect(sweep.expiredPending).toBe(0);
      // Honest "back in flight" gray, attributed to the dead holder.
      expect(sweep.commErrors).toHaveLength(1);
      expect(sweep.commErrors[0].kind).toBe("worker-reclaimed-pending");
      expect(sweep.commErrors[0].jobId).toBe("long-dead");
      // The reclaim tally was bumped and the stale-age clock re-anchored.
      expect(row?.reclaim_count).toBe(1);
      expect(row?.requeued_at).toBe(new Date(T).toISOString());
    });

    it("ATTEMPT CAP (layer a): a stale-aged long-expired orphan AT MAX_RECLAIM_ATTEMPTS consecutive orphans is claim-DELETED — a poison job cannot re-queue forever", async () => {
      // The reclaim-wins inversion is bounded: a row that has already been
      // reclaimed MAX_RECLAIM_ATTEMPTS times CONSECUTIVELY (consecutive_orphan_count
      // at cap) and STILL re-orphaned (it crashes the worker every run) falls
      // through to the carve-out delete — no re-queue, no comm error, counted
      // with the stale expiries — so the queue cannot loop on a genuinely poison
      // job.
      const poison: CreatedJobRow = {
        ...jobView({
          id: "poison",
          probe_key: "d6:a",
          status: "running",
          claimed_by: "worker-dead",
          lease_expires_at: new Date(T - 4 * HOUR).toISOString(),
        }),
        payload: samplePayload({ probeKey: "d6:a" }),
        created: new Date(T - 8 * HOUR).toISOString(),
        // Already at the cap: consecutive re-orphans, never completed.
        consecutive_orphan_count: MAX_RECLAIM_ATTEMPTS,
      };
      const { pb, store } = makePagingPb([poison]);
      const sink = { releasedPending: [] as string[] };
      const claim = makeReclaimClaim(store, T, sink);
      const q = createFleetQueueClient({ pb, claim, logger });

      const sweep = await q.sweepExpired(T);

      // DELETED (terminal): no re-queue, no comm error, counted as expired.
      expect(store.find((r) => r.id === "poison")).toBeUndefined();
      expect(sink.releasedPending).not.toContain("poison");
      expect(sweep.commErrors).toHaveLength(0);
      expect(sweep.reclaimed).toBe(0);
      expect(sweep.expiredPending).toBe(1);
      expect(logger.warn).toHaveBeenCalledWith(
        "queue-client.sweep-lease-stale-deleted",
        expect.objectContaining({
          jobId: "poison",
          reclaimAttempts: MAX_RECLAIM_ATTEMPTS,
        }),
      );
    });

    it("HONESTY BIND DISSOLVED (layer a): the sweep AFTER a reclaim does NOT falsify the 'back in flight' signal — requeued_at re-anchors the stale-age clock", async () => {
      // The carve-out USED to delete-rather-than-reclaim precisely because the
      // NEXT sweep would age a re-queued row off its renewal-immune `created`
      // and claim-delete it — falsifying the just-emitted "back in flight"
      // gray. With requeued_at the next sweep ages the row off its RE-QUEUE
      // time: still pending, still stale by `created`, but YOUNG by
      // requeued_at, so drainStalePending SKIPS it (no delete). The signal
      // holds. Sweep 1 reclaims; sweep 2 (a stale-window later) must NOT
      // delete the still-pending row.
      const longDead: CreatedJobRow = {
        ...jobView({
          id: "long-dead",
          probe_key: "d6:a",
          status: "running",
          claimed_by: "worker-dead",
          lease_expires_at: new Date(T - 4 * HOUR).toISOString(),
        }),
        payload: samplePayload({ probeKey: "d6:a" }),
        created: new Date(T - 8 * HOUR).toISOString(),
        reclaim_count: 0,
      };
      const { pb, store } = makePagingPb([longDead]);
      const sink = { releasedPending: [] as string[] };
      const claim = makeReclaimClaim(store, T, sink);
      const q = createFleetQueueClient({ pb, claim, logger });

      // Sweep 1 at T: reclaim to pending, requeued_at = T.
      const sweep1 = await q.sweepExpired(T);
      expect(sweep1.reclaimed).toBe(1);
      expect(sweep1.expiredPending).toBe(0);
      const afterReclaim = store.find((r) => r.id === "long-dead");
      expect(afterReclaim?.status).toBe("pending");
      expect(afterReclaim?.requeued_at).toBe(new Date(T).toISOString());

      // Sweep 2 a stale-window later (T + 1min): the row is STILL pending and
      // STILL stale by its 8h-old `created`, but requeued_at = T makes it only
      // 1min old by the re-anchor — far inside the 3h window — so it is NOT
      // claim-deleted. The "back in flight" signal from sweep 1 stands.
      const T2 = T + MIN;
      const sweep2 = await q.sweepExpired(T2);
      expect(store.find((r) => r.id === "long-dead")?.status).toBe("pending");
      expect(sweep2.expiredPending).toBe(0);
    });

    // ── P1-A RED-GREEN REGRESSION ────────────────────────────────────────────
    // A job that has accrued N benign peer steals over its lifetime (high
    // reclaim_count) but ZERO consecutive sweeper re-orphans must be RE-QUEUED
    // on its first real orphan — NOT deleted. Pre-fix this was broken because
    // the cap used `reclaim_count` (bumped by both steal + re-queue paths), so
    // a long-lived job with many peer steals would hit the cap and get
    // claim-DELETED on its first fresh orphan.
    it("P1-A CAP SCOPE: a job with benign peer steals (high reclaim_count) but no consecutive orphans is RE-QUEUED on its first fresh orphan, never deleted", async () => {
      // Simulate a job that has been stolen by peers 3 times (reclaim_count=3
      // — already AT the old cap) but has consecutive_orphan_count=0 (never
      // been re-queued by the sweeper — it always re-ran successfully).
      const longLived: CreatedJobRow = {
        ...jobView({
          id: "long-lived",
          probe_key: "d6:a",
          status: "running",
          claimed_by: "worker-dead",
          // Lease expired 4h ago — LONGER than the 3h (3×60min) stale window.
          lease_expires_at: new Date(T - 4 * HOUR).toISOString(),
        }),
        payload: samplePayload({ probeKey: "d6:a" }),
        created: new Date(T - 8 * HOUR).toISOString(), // stale-aged
        // LIFETIME tally at the old-cap value (3 benign steals).
        reclaim_count: MAX_RECLAIM_ATTEMPTS,
        // But ZERO consecutive sweeper re-orphans: should NOT be deleted.
        consecutive_orphan_count: 0,
      };
      const { pb, store } = makePagingPb([longLived]);
      const sink = { releasedPending: [] as string[] };
      const claim = makeReclaimClaim(store, T, sink);
      const q = createFleetQueueClient({ pb, claim, logger });

      const sweep = await q.sweepExpired(T);

      // Must be RE-QUEUED (non-lossy), not deleted.
      const row = store.find((r) => r.id === "long-lived");
      expect(row).toBeDefined();
      expect(row?.status).toBe("pending");
      expect(sink.releasedPending).toContain("long-lived");
      expect(sweep.reclaimed).toBe(1);
      expect(sweep.expiredPending).toBe(0);
      // consecutive_orphan_count was 0 before → 1 after first sweeper re-queue.
      expect(row?.consecutive_orphan_count).toBe(1);
      // lifetime tally still increases (the re-queue path bumps it too).
      expect(row?.reclaim_count).toBe(MAX_RECLAIM_ATTEMPTS + 1);
    });

    // ── P1-B LOW-BOUNDARY TEST ───────────────────────────────────────────────
    // The LOW boundary of the cap must be pinned: a row at consecutive_orphan_count
    // = MAX-1 (= 2) must be RE-QUEUED (pending), never deleted. Without this
    // test, a mutation `>= MAX` → `>= MAX-1` (delete one attempt too early)
    // passes all other tests undetected.
    it("P1-B CAP LOW BOUNDARY: a stale-aged orphan at consecutive_orphan_count = MAX-1 is RE-QUEUED (not deleted) — the low boundary is pinned", async () => {
      const nearCap: CreatedJobRow = {
        ...jobView({
          id: "near-cap",
          probe_key: "d6:a",
          status: "running",
          claimed_by: "worker-dead",
          lease_expires_at: new Date(T - 4 * HOUR).toISOString(),
        }),
        payload: samplePayload({ probeKey: "d6:a" }),
        created: new Date(T - 8 * HOUR).toISOString(),
        // ONE BELOW the cap (= 2 when MAX = 3): must be RE-QUEUED.
        consecutive_orphan_count: MAX_RECLAIM_ATTEMPTS - 1,
      };
      const { pb, store } = makePagingPb([nearCap]);
      const sink = { releasedPending: [] as string[] };
      const claim = makeReclaimClaim(store, T, sink);
      const q = createFleetQueueClient({ pb, claim, logger });

      const sweep = await q.sweepExpired(T);

      // Must be RE-QUEUED at MAX-1 (not at cap yet).
      const row = store.find((r) => r.id === "near-cap");
      expect(row).toBeDefined();
      expect(row?.status).toBe("pending");
      expect(sink.releasedPending).toContain("near-cap");
      expect(sweep.reclaimed).toBe(1);
      expect(sweep.expiredPending).toBe(0);
      // Counter now at MAX_RECLAIM_ATTEMPTS (cap) — NEXT orphan would be deleted.
      expect(row?.consecutive_orphan_count).toBe(MAX_RECLAIM_ATTEMPTS);
    });

    // ── STEAL-BUDGET PIN ─────────────────────────────────────────────────────
    // Explicit test that an expired-lease steal (peer claim of an abandoned row)
    // does NOT increment consecutive_orphan_count — steals must never consume
    // the reclaim budget.
    it("peer-worker expired-lease steal does NOT consume the consecutive_orphan_count budget (steals bump lifetime reclaim_count only)", async () => {
      // A row with consecutive_orphan_count near the cap but with an
      // expired-lease that will be claimed (stolen) by a peer worker.
      const contested: CreatedJobRow = {
        ...jobView({
          id: "contested",
          probe_key: "d6:a",
          status: "running",
          claimed_by: "worker-old",
          // Lease expired but NOT stale-aged — so the carve-out does NOT apply;
          // this tests the claim steal path in isolation.
          lease_expires_at: new Date(T - 5 * MIN).toISOString(),
        }),
        payload: samplePayload({ probeKey: "d6:a" }),
        // Recent: not stale-aged, won't hit the carve-out.
        created: new Date(T - 10 * MIN).toISOString(),
        reclaim_count: 2,
        consecutive_orphan_count: MAX_RECLAIM_ATTEMPTS - 1,
      };
      const store = [contested];
      // Claim the row as a "peer" via the fake's claimJob (the steal path).
      const claim = makeReclaimClaim(store, T);
      const result = await claim.claimJob("contested", "worker-peer", 30);
      expect(result.won).toBe(true);

      const row = store.find((r) => r.id === "contested");
      // Lifetime tally bumped by the steal.
      expect(row?.reclaim_count).toBe(3);
      // Consecutive budget NOT consumed by the steal.
      expect(row?.consecutive_orphan_count).toBe(MAX_RECLAIM_ATTEMPTS - 1);
    });

    it("a release that THROWS after committing server-side still graces the row AND synthesizes its comm error (timeout-after-commit)", async () => {
      // TIMEOUT-AFTER-COMMIT: the release CAS can COMMIT server-side and the
      // response then be lost in transit (the client sees a throw). The row
      // IS pending now, but a plain `continue` on the throw leaves it (a)
      // absent from the grace set — the SAME call's stale phase can
      // claim-and-delete it — and (b) without its worker-reclaimed-pending
      // comm error, which no later sweep re-emits (the row is pending, so
      // the lease phase never sees it again): the gray "re-queued" surface
      // is lost FOREVER. The fix is conservative at-least-once handling: on
      // a thrown release, grace the row and synthesize the comm error
      // anyway. If the release did NOT commit, the next sweep retries and a
      // duplicate gray overlay may render — harmless; a missing one is not.
      const longClaimed: CreatedJobRow = {
        ...jobView({
          id: "throw-commit",
          probe_key: "d6:a",
          status: "running",
          claimed_by: "worker-dead",
          lease_expires_at: new Date(T - MIN).toISOString(),
        }),
        payload: samplePayload({ probeKey: "d6:a" }),
        created: new Date(T - 4 * HOUR).toISOString(), // stale (> 3 × 60min)
      };
      const { pb, store } = makePagingPb([longClaimed]);
      const base = makeStoreClaim(store);
      const claim: JobClaimClient = {
        ...base,
        // COMMIT, then throw — the server applied the re-queue but the
        // response never reached the client.
        async releaseJob(jobId, workerId): Promise<ReleaseResult> {
          const r = store.find((x) => x.id === jobId);
          if (!r || r.claimed_by !== workerId) return { released: false };
          r.status = "pending";
          r.claimed_by = "";
          r.version += 1;
          throw new Error("socket timeout after commit");
        },
      };
      const q = createFleetQueueClient({ pb, claim, logger });

      const sweep = await q.sweepExpired(T);

      // The comm error was synthesized despite the throw (at-least-once)...
      expect(sweep.commErrors).toHaveLength(1);
      expect(sweep.commErrors[0].kind).toBe("worker-reclaimed-pending");
      expect(sweep.commErrors[0].jobId).toBe("throw-commit");
      // ...counted as an INDETERMINATE maybe, not a confirmed reclaim (G1g):
      // `reclaimed` counts only CAS-confirmed releases; the conservative
      // thrown-release maybes ride the separate at-least-once counter.
      expect(sweep.reclaimed).toBe(0);
      expect(sweep.reclaimedIndeterminate).toBe(1);
      // ...and the grace set protected the (committed-pending, stale) row
      // from the SAME sweep's stale phase — it survives to be re-claimed.
      expect(sweep.expiredPending).toBe(0);
      expect(store.find((r) => r.id === "throw-commit")?.status).toBe(
        "pending",
      );
      expect(logger.warn).toHaveBeenCalledWith(
        "queue-client.sweep-release-threw",
        expect.objectContaining({ jobId: "throw-commit" }),
      );
    });

    it("applies the grace set on EVERY page of the multi-page stale drain (pagination must not out-run the grace)", async () => {
      // COMPOSITION: the one-sweep grace × the multi-page drain. A re-queued
      // row whose `created` sorts AFTER a full page of older stale rows only
      // surfaces on the drain's SECOND pass — if the grace check were applied
      // per-sweep-entry instead of per-row-per-pass, pass 2 would delete it
      // and falsify the worker-reclaimed-pending comm error just emitted.
      const longClaimed: CreatedJobRow = {
        ...jobView({
          id: "long-claimed",
          probe_key: "d6:graced",
          status: "running",
          claimed_by: "worker-dead",
          lease_expires_at: new Date(T - MIN).toISOString(),
        }),
        payload: samplePayload({ probeKey: "d6:graced" }),
        // Stale (3.5h > 3 × 60min default) but YOUNGER than every backlog row
        // below, so after the lease-phase re-queue it lands beyond page 1 of
        // the created-ascending drain.
        created: new Date(T - 3.5 * HOUR).toISOString(),
      };
      // 60 older stale rows: page 1 of the drain (50) is saturated by them,
      // pushing the graced row onto pass 2.
      const backlog = Array.from({ length: 60 }, (_, i) =>
        pendingRow(`stale-${i}`, "d6:a", T - 4 * HOUR - i * 1000),
      );
      const { pb, store } = makePagingPb([longClaimed, ...backlog]);
      const base = makeStoreClaim(store);
      const claim: JobClaimClient = {
        ...base,
        async releaseJob(jobId, workerId, status): Promise<ReleaseResult> {
          const r = store.find((x) => x.id === jobId);
          if (!r || r.claimed_by !== workerId) return { released: false };
          r.status = status;
          r.claimed_by = "";
          r.version += 1;
          return { released: true, job: { ...r } };
        },
      };
      const q = createFleetQueueClient({ pb, claim, logger });

      const sweep = await q.sweepExpired(T);

      // Lease phase: re-queued the long-claimed row with the neutral signal.
      expect(sweep.reclaimed).toBe(1);
      expect(sweep.commErrors).toHaveLength(1);
      expect(sweep.commErrors[0].jobId).toBe("long-claimed");
      // Drain: the whole 60-row backlog dies across two passes, but the
      // graced row — seen only on pass 2 — survives the sweep.
      expect(sweep.expiredPending).toBe(60);
      expect(store).toHaveLength(1);
      expect(store[0].id).toBe("long-claimed");
      expect(store[0].status).toBe("pending");
    });
  });

  describe("sweepExpired — LEASE-SCAN PAGING (mass worker crash backlog)", () => {
    // The lease phase lists claimed/running rows with perPage 50. Under a mass
    // worker crash (>50 such rows), an UNSORTED list left the page contents to
    // PB's unspecified default order — the same 50 live-lease rows could come
    // back every sweep, leaving expired leases beyond the page PERMANENTLY
    // invisible (zero reclaimed, zero signal). The fix sorts by
    // lease_expires_at ascending so the most-expired rows always land at the
    // head of the page, and WARNs when the page is full (truncation is
    // observable).

    const NOW = Date.parse("2026-06-04T00:05:00.000Z");

    function runningRow(id: string, leaseExpiresAt: string): CreatedJobRow {
      return {
        ...jobView({
          id,
          probe_key: `d6:${id}`,
          status: "running",
          claimed_by: `w-${id}`,
          lease_expires_at: leaseExpiresAt,
          version: 1,
        }),
        payload: samplePayload({ probeKey: `d6:${id}` }),
        // Recent enough that the stale-pending phase never touches a
        // reclaimed (now-pending) row in the same sweep.
        created: "2026-06-04T00:00:00.000Z",
      };
    }

    /** A store-mutating releaseJob: CAS on claimed_by, re-queues to pending.
     * Hook-faithful: lease_expires_at is RETAINED on re-queue (the hook keeps
     * it as the row's last-in-flight marker — parity-pinned below). */
    function makeStoreReleaseClaim(store: CreatedJobRow[]): JobClaimClient {
      return {
        ...makeStoreClaim(store),
        async releaseJob(jobId, workerId, status): Promise<ReleaseResult> {
          const row = store.find((r) => r.id === jobId);
          if (!row || row.claimed_by !== workerId) return { released: false };
          row.status = status as JobStatus;
          row.claimed_by = "";
          row.version += 1;
          return { released: true, job: { ...row } };
        },
      };
    }

    it("reclaims expired leases buried beyond the 50-row page on the FIRST sweep (lease_expires_at ascending); a live tail is NOT a truncation warn", async () => {
      // 52 live rows inserted FIRST, 3 expired rows LAST: under insertion
      // order the perPage-50 page contains ONLY live rows, so the unsorted
      // scan misses the expired ones on every sweep (RED: zero reclaimed
      // across two sweeps).
      const rows: CreatedJobRow[] = [];
      for (let i = 0; i < 52; i++) {
        rows.push(
          runningRow(
            `live-${String(i).padStart(2, "0")}`,
            "2026-06-04T00:06:00.000Z",
          ),
        );
      }
      for (let i = 0; i < 3; i++) {
        rows.push(runningRow(`dead-${i}`, "2026-06-04T00:01:00.000Z"));
      }
      const { pb, store } = makePagingPb(rows);
      const q = createFleetQueueClient({
        pb,
        claim: makeStoreReleaseClaim(store),
        logger,
      });
      const warnSpy = vi.spyOn(logger, "warn");

      const sweep = await q.sweepExpired(NOW);

      // Expired-first sort surfaces all 3 dead leases on the FIRST sweep.
      expect(sweep.reclaimed).toBe(3);
      for (let i = 0; i < 3; i++) {
        expect(store.find((r) => r.id === `dead-${i}`)?.status).toBe("pending");
      }
      // The page IS full, but its TAIL lease is live — under the ascending
      // sort every truncated row beyond it is live too, so nothing expirable
      // was hidden and the truncation warn must NOT fire (it would be a false
      // positive at any healthy ≥50-in-flight steady state).
      expect(warnSpy).not.toHaveBeenCalledWith(
        "queue-client.sweep-lease-page-truncated",
        expect.anything(),
      );

      // A second sweep finds nothing further expired (and reclaims nothing
      // twice) — forward progress, not the same-page-forever pathology.
      const sweep2 = await q.sweepExpired(NOW);
      expect(sweep2.reclaimed).toBe(0);
      warnSpy.mockRestore();
    });

    it("does NOT warn on a FULL page of exactly 50 all-live leases (healthy steady state)", async () => {
      // Boundary: exactly perPage healthy in-flight jobs. The old any-full-page
      // warn fired here every sweep — pure noise with nothing truncated that
      // could matter.
      const rows = Array.from({ length: 50 }, (_, i) =>
        runningRow(
          `live-${String(i).padStart(2, "0")}`,
          "2026-06-04T00:06:00.000Z",
        ),
      );
      const { pb, store } = makePagingPb(rows);
      const q = createFleetQueueClient({
        pb,
        claim: makeStoreReleaseClaim(store),
        logger,
      });

      const sweep = await q.sweepExpired(NOW);

      expect(sweep.reclaimed).toBe(0);
      expect(logger.warn).not.toHaveBeenCalledWith(
        "queue-client.sweep-lease-page-truncated",
        expect.anything(),
      );
    });

    it("warns on a FULL page whose TAIL lease is expired (expirable rows may lie beyond)", async () => {
      // Boundary: exactly perPage rows, ALL expired — the tail being expired
      // means rows beyond the page (if any) could be expired too, so the
      // truncation is the one that matters and must be observable.
      const rows = Array.from({ length: 50 }, (_, i) =>
        runningRow(
          `dead-${String(i).padStart(2, "0")}`,
          "2026-06-04T00:01:00.000Z",
        ),
      );
      const { pb, store } = makePagingPb(rows);
      const q = createFleetQueueClient({
        pb,
        claim: makeStoreReleaseClaim(store),
        logger,
      });

      const sweep = await q.sweepExpired(NOW);

      expect(sweep.reclaimed).toBe(50);
      expect(logger.warn).toHaveBeenCalledWith(
        "queue-client.sweep-lease-page-truncated",
        expect.objectContaining({ perPage: 50 }),
      );
    });

    it("does NOT warn about truncation when the claimed/running page is not full", async () => {
      const { pb, store } = makePagingPb([
        runningRow("dead-0", "2026-06-04T00:01:00.000Z"),
      ]);
      const q = createFleetQueueClient({
        pb,
        claim: makeStoreReleaseClaim(store),
        logger,
      });
      const warnSpy = vi.spyOn(logger, "warn");

      const sweep = await q.sweepExpired(NOW);

      expect(sweep.reclaimed).toBe(1);
      expect(warnSpy).not.toHaveBeenCalledWith(
        "queue-client.sweep-lease-page-truncated",
        expect.anything(),
      );
      warnSpy.mockRestore();
    });
  });
});

describe("FleetQueueClient.renewLease", () => {
  it("delegates to S0 renewLease and returns the refreshed lease", async () => {
    const { pb } = makeFakePb([{ ...jobView(), payload: samplePayload() }]);
    const claim = makeFakeClaim({
      renewLease: vi.fn(
        async (): Promise<RenewResult> => ({
          renewed: true,
          job: jobView({
            id: "j1",
            status: "running",
            claimed_by: "worker-7",
            lease_expires_at: "2026-06-04T00:02:00.000Z",
            version: 2,
          }),
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const lease = await q.renewLease("j1", "worker-7", 30);

    expect(claim.renewLease).toHaveBeenCalledWith("j1", "worker-7", 30);
    expect(lease?.job.status).toBe("running");
    expect(lease?.leaseExpiresAt).toBe("2026-06-04T00:02:00.000Z");
    expect(lease?.payload).toEqual(samplePayload());
  });

  it("returns null when the lease was lost", async () => {
    const { pb } = makeFakePb([{ ...jobView(), payload: samplePayload() }]);
    const claim = makeFakeClaim();
    const q = createFleetQueueClient({ pb, claim, logger });

    const lease = await q.renewLease("j1", "worker-7", 30);

    expect(lease).toBeNull();
  });

  it("renews from the claim-time payload CACHE — the convenience re-read is never consulted on a cache hit", async () => {
    // CACHE-HIT path (explicitly pinned): the CAS renewed and returned the
    // lifecycle columns, and the payload comes from the claim-time cache —
    // pb.getOne must NOT be called at all. (The stubbed null getOne below
    // would be a failed re-read IF it were consulted; the not-called pin
    // keeps this test honest about WHICH path it covers. The cache-MISS +
    // failed-re-read path is pinned separately by the "cache miss AND
    // reread fail" test below.)
    const payload = samplePayload();
    // Seed the store so claimNext can populate the payload cache, then the
    // renew re-read still works against this same row.
    const { pb } = makeFakePb([{ ...jobView({ id: "j1" }), payload }]);
    const claim = makeFakeClaim({
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({
            id: jobId,
            status: "claimed",
            claimed_by: workerId,
            lease_expires_at: "2026-06-04T00:01:00.000Z",
            version: 1,
          }),
        }),
      ),
      renewLease: vi.fn(
        async (): Promise<RenewResult> => ({
          renewed: true,
          job: jobView({
            id: "j1",
            status: "running",
            claimed_by: "worker-7",
            lease_expires_at: "2026-06-04T00:02:00.000Z",
            version: 2,
          }),
        }),
      ),
      // getOne is never required for a successful renew.
    });
    const getOneSpy = vi.fn(async () => null);
    pb.getOne = getOneSpy as PbClient["getOne"];
    const q = createFleetQueueClient({ pb, claim, logger });

    // Claim first so the payload cache is populated for this jobId.
    await q.claimNext("worker-7", 30);

    const lease = await q.renewLease("j1", "worker-7", 30);

    expect(lease).not.toBeNull();
    expect(lease?.job.status).toBe("running");
    expect(lease?.leaseExpiresAt).toBe("2026-06-04T00:02:00.000Z");
    expect(lease?.payload).toEqual(payload);
    // The cache HIT means the convenience re-read was never consulted.
    expect(getOneSpy).not.toHaveBeenCalled();
  });

  it("EVICTS the cached payload when the renew CAS is lost (no payloadCache leak)", async () => {
    // A lost renew CAS means this worker never touches the job again — no
    // report() (whose finally is the only other eviction), no further renew.
    // Without eviction here the claim-time cache entry strands FOREVER and
    // the per-client map grows with every abandoned/stolen job. Proof of
    // eviction: a LATER successful renew for the same jobId must take the
    // convenience RE-READ path (cache miss → pb.getOne), not the cache.
    const payload = samplePayload();
    const { pb } = makeFakePb([{ ...jobView({ id: "j1" }), payload }]);
    const getOneSpy = vi.fn(pb.getOne.bind(pb));
    pb.getOne = getOneSpy as PbClient["getOne"];
    let renewWins = false;
    const claim = makeFakeClaim({
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        }),
      ),
      renewLease: vi.fn(
        async (): Promise<RenewResult> =>
          renewWins
            ? {
                renewed: true,
                job: jobView({
                  id: "j1",
                  status: "running",
                  claimed_by: "worker-7",
                  lease_expires_at: "2026-06-04T00:02:00.000Z",
                  version: 2,
                }),
              }
            : { renewed: false },
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    // Claim populates the cache…
    await q.claimNext("worker-7", 30);
    expect(getOneSpy).not.toHaveBeenCalled();
    // …the renew LOSES the CAS → null AND the cache entry is evicted…
    expect(await q.renewLease("j1", "worker-7", 30)).toBeNull();
    // …so a later successful renew re-hydrates via the re-read, proving the
    // entry is gone (a leaked entry would skip getOne entirely).
    renewWins = true;
    const lease = await q.renewLease("j1", "worker-7", 30);
    expect(lease).not.toBeNull();
    expect(lease?.payload).toEqual(payload);
    expect(getOneSpy).toHaveBeenCalledTimes(1);
  });

  it("claim → report → renew takes the re-read path (report's eviction actually evicts)", async () => {
    const payload = samplePayload();
    const { pb } = makeFakePb([{ ...jobView({ id: "j1" }), payload }]);
    const getOneSpy = vi.fn(pb.getOne.bind(pb));
    pb.getOne = getOneSpy as PbClient["getOne"];
    const claim = makeFakeClaim({
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        }),
      ),
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({ released: true }),
      ),
      renewLease: vi.fn(
        async (): Promise<RenewResult> => ({
          renewed: true,
          job: jobView({
            id: "j1",
            status: "running",
            claimed_by: "worker-7",
            lease_expires_at: "2026-06-04T00:02:00.000Z",
            version: 2,
          }),
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    await q.claimNext("worker-7", 30);
    await q.report({
      jobId: "j1",
      workerId: "worker-7",
      result: sampleResult(),
    });
    // The cache entry died with the report; a renew (e.g. a late heartbeat
    // racing the report) must re-read rather than serve the stale entry.
    const lease = await q.renewLease("j1", "worker-7", 30);
    expect(lease).not.toBeNull();
    expect(getOneSpy).toHaveBeenCalledTimes(1);
  });

  it("logs a renew re-read DECODE failure as a protocol violation, not a read blip", async () => {
    // The re-read catch used to swallow decodePayload throws under the
    // "queue-client.renew-reread-failed" READ-BLIP warn — but a row whose
    // persisted payload no longer decodes is a PROTOCOL problem (a poison
    // row), not a transient PB read failure, and triaging it as a blip
    // hides it from anyone grepping for protocol violations. The renew
    // itself still succeeds (heartbeat-only empty payload).
    const { pb } = makeFakePb([
      {
        ...jobView({ id: "j1" }),
        payload: "garbage" as unknown as ServiceJobPayload,
      },
    ]);
    const claim = makeFakeClaim({
      renewLease: vi.fn(
        async (): Promise<RenewResult> => ({
          renewed: true,
          job: jobView({
            id: "j1",
            status: "running",
            claimed_by: "worker-7",
            lease_expires_at: "2026-06-04T00:02:00.000Z",
            version: 2,
          }),
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    // No prior claim → cache miss → re-read returns the poison row.
    const lease = await q.renewLease("j1", "worker-7", 30);

    expect(lease).not.toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      "queue-client.renew-reread-protocol-violation",
      expect.objectContaining({ jobId: "j1" }),
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      "queue-client.renew-reread-failed",
      expect.anything(),
    );
  });

  it("renewed-without-job with NO cached lease warns and returns null (nothing to assume-live from)", async () => {
    const { pb } = makeFakePb([{ ...jobView(), payload: samplePayload() }]);
    const claim = makeFakeClaim({
      // renewed:true with NO job violates the endpoint contract.
      renewLease: vi.fn(async (): Promise<RenewResult> => ({ renewed: true })),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    // No prior claim in this process → no cached lease to keep alive.
    const lease = await q.renewLease("j1", "worker-7", 30);

    expect(lease).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.renew-renewed-without-job",
      expect.objectContaining({ jobId: "j1", workerId: "worker-7" }),
    );
  });

  it("renewed-without-job with a CACHED lease keeps it assumed-live — a SUCCESSFUL renew must not stop the heartbeat (G1b)", async () => {
    // The renew CAS WON (renewed:true) — the job is LIVE and this worker
    // still holds it; only the response's job view is missing (a protocol
    // violation in the endpoint, not a lost lease). Evicting the caches and
    // returning null here made the heartbeat read a HEALTHY renew as a lost
    // lease, stop beating, and let the sweeper falsely reclaim a LIVE job.
    // Like the indeterminate path, the cached lease is returned assumed-live
    // so the next beat retries; eviction is reserved for definitive losses.
    const payload = samplePayload();
    const { pb } = makeFakePb([{ ...jobView({ id: "j1" }), payload }]);
    const getOneSpy = vi.fn(pb.getOne.bind(pb));
    pb.getOne = getOneSpy as PbClient["getOne"];
    let renewMode: "withoutJob" | "win" = "withoutJob";
    const claim = makeFakeClaim({
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({
            id: jobId,
            status: "claimed",
            claimed_by: workerId,
            lease_expires_at: "2026-06-04T00:01:00.000Z",
            version: 1,
          }),
        }),
      ),
      renewLease: vi.fn(async (): Promise<RenewResult> => {
        if (renewMode === "withoutJob") return { renewed: true };
        return {
          renewed: true,
          job: jobView({
            id: "j1",
            status: "running",
            claimed_by: "worker-7",
            lease_expires_at: "2026-06-04T00:02:00.000Z",
            version: 2,
          }),
        };
      }),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    await q.claimNext("worker-7", 30);

    // The breach is warned, but the cached (claim-time) lease comes back —
    // NOT null — so the heartbeat keeps the live job alive.
    const kept = await q.renewLease("j1", "worker-7", 30);
    expect(kept).not.toBeNull();
    expect(kept?.leaseExpiresAt).toBe("2026-06-04T00:01:00.000Z");
    expect(kept?.payload).toEqual(payload);
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.renew-renewed-without-job",
      expect.objectContaining({ jobId: "j1", workerId: "worker-7" }),
    );

    // No eviction happened: the next (well-formed) renew re-hydrates from
    // the claim-time cache, never the convenience re-read.
    renewMode = "win";
    const next = await q.renewLease("j1", "worker-7", 30);
    expect(next?.leaseExpiresAt).toBe("2026-06-04T00:02:00.000Z");
    expect(next?.payload).toEqual(payload);
    expect(getOneSpy).not.toHaveBeenCalled();
  });

  it("a THROWN renew (5xx / unreadable-2xx) keeps the CURRENT lease assumed-live instead of killing the heartbeat", async () => {
    // INDETERMINACY CONTAINMENT (G1b): a renew that THROWS (transport blip,
    // 5xx, or job-claim's 2xx-unreadable indeterminate) may or may not have
    // committed. The worker heartbeat catches a renewLease throw and BREAKS
    // (worker-loop.ts), so an escaped throw stops heartbeating → the sweeper
    // reclaims a LIVE job → a FALSE worker-crashed-mid-job. renewLease must
    // contain the throw: warn, keep the last-known lease assumed-live, and
    // let the NEXT beat retry. Only a definitive renewed:false stops the
    // heartbeat.
    const payload = samplePayload();
    const { pb } = makeFakePb([{ ...jobView({ id: "j1" }), payload }]);
    const getOneSpy = vi.fn(pb.getOne.bind(pb));
    pb.getOne = getOneSpy as PbClient["getOne"];
    let renewThrows = true;
    const claim = makeFakeClaim({
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({
            id: jobId,
            status: "claimed",
            claimed_by: workerId,
            lease_expires_at: "2026-06-04T00:01:00.000Z",
            version: 1,
          }),
        }),
      ),
      renewLease: vi.fn(async (): Promise<RenewResult> => {
        if (renewThrows)
          throw new Error("2xx body unreadable — outcome indeterminate");
        return {
          renewed: true,
          job: jobView({
            id: "j1",
            status: "running",
            claimed_by: "worker-7",
            lease_expires_at: "2026-06-04T00:02:00.000Z",
            version: 2,
          }),
        };
      }),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    await q.claimNext("worker-7", 30);

    // The thrown renew is contained: the CURRENT (claim-time) lease comes
    // back unchanged — NOT null — so the heartbeat continues.
    const kept = await q.renewLease("j1", "worker-7", 30);
    expect(kept).not.toBeNull();
    expect(kept?.leaseExpiresAt).toBe("2026-06-04T00:01:00.000Z");
    expect(kept?.payload).toEqual(payload);
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.renew-indeterminate",
      expect.objectContaining({ jobId: "j1", workerId: "worker-7" }),
    );

    // The payload cache was NOT evicted by the indeterminate beat: the next
    // (successful) renew re-hydrates from cache, never the convenience
    // re-read.
    renewThrows = false;
    const next = await q.renewLease("j1", "worker-7", 30);
    expect(next?.leaseExpiresAt).toBe("2026-06-04T00:02:00.000Z");
    expect(next?.payload).toEqual(payload);
    expect(getOneSpy).not.toHaveBeenCalled();
  });

  it("a thrown renew carrying a DETERMINISTIC 4xx is a definitive loss — evicts the caches and returns null (G1a)", async () => {
    // The indeterminate containment above is for failures that MAY have
    // committed (5xx / transport / 2xx-unreadable). A 4xx from the renew
    // endpoint is the hook REJECTING the request before its transaction ran
    // (rotated creds → auth 400s, malformed ids, route drift) — it fails
    // IDENTICALLY on every beat, so "assumed-live, retry next beat" never
    // converges: the worker holds a phantom lease FOREVER while the server
    // lease lapses and the sweeper hands the job to another worker
    // (unbounded double-run — falsifying the documented one-lease-duration
    // risk bound). A deterministic rejection must be treated like a lost
    // CAS: error log, evict both caches, return null so the heartbeat stops.
    const payload = samplePayload();
    const { pb } = makeFakePb([{ ...jobView({ id: "j1" }), payload }]);
    const getOneSpy = vi.fn(pb.getOne.bind(pb));
    pb.getOne = getOneSpy as PbClient["getOne"];
    let renewMode: "reject4xx" | "win" = "reject4xx";
    const claim = makeFakeClaim({
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({
            id: jobId,
            status: "claimed",
            claimed_by: workerId,
            lease_expires_at: "2026-06-04T00:01:00.000Z",
            version: 1,
          }),
        }),
      ),
      renewLease: vi.fn(async (): Promise<RenewResult> => {
        if (renewMode === "reject4xx") {
          throw new JobClaimEndpointError(
            "/api/fleet/renew",
            400,
            "workerId must be a string",
          );
        }
        return {
          renewed: true,
          job: jobView({
            id: "j1",
            status: "running",
            claimed_by: "worker-7",
            lease_expires_at: "2026-06-04T00:02:00.000Z",
            version: 2,
          }),
        };
      }),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    await q.claimNext("worker-7", 30);

    // Definitive loss: null (heartbeat stops), error-level log.
    const lost = await q.renewLease("j1", "worker-7", 30);
    expect(lost).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      "queue-client.renew-rejected",
      expect.objectContaining({
        jobId: "j1",
        workerId: "worker-7",
        status: 400,
      }),
    );
    // The assumed-live warn must NOT fire for a deterministic rejection.
    expect(logger.warn).not.toHaveBeenCalledWith(
      "queue-client.renew-indeterminate",
      expect.anything(),
    );

    // Eviction proof: a later successful renew takes the convenience RE-READ
    // path (cache miss → pb.getOne) — a leaked cache entry would skip it.
    renewMode = "win";
    const lease = await q.renewLease("j1", "worker-7", 30);
    expect(lease).not.toBeNull();
    expect(getOneSpy).toHaveBeenCalledTimes(1);
  });

  it("a thrown renew carrying a 5xx JobClaimEndpointError KEEPS the assumed-live containment (G1a contrast)", async () => {
    // Only the DETERMINISTIC 4xx class is carved out: a 5xx is genuinely
    // indeterminate (the renew may have committed before the error
    // surfaced), so the lease stays assumed-live and the next beat retries.
    const payload = samplePayload();
    const { pb } = makeFakePb([{ ...jobView({ id: "j1" }), payload }]);
    const claim = makeFakeClaim({
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({
            id: jobId,
            status: "claimed",
            claimed_by: workerId,
            lease_expires_at: "2026-06-04T00:01:00.000Z",
            version: 1,
          }),
        }),
      ),
      renewLease: vi.fn(async (): Promise<RenewResult> => {
        throw new JobClaimEndpointError("/api/fleet/renew", 502, "bad gateway");
      }),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    await q.claimNext("worker-7", 30);

    const kept = await q.renewLease("j1", "worker-7", 30);
    expect(kept).not.toBeNull();
    expect(kept?.leaseExpiresAt).toBe("2026-06-04T00:01:00.000Z");
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.renew-indeterminate",
      expect.objectContaining({ jobId: "j1" }),
    );
    expect(logger.error).not.toHaveBeenCalledWith(
      "queue-client.renew-rejected",
      expect.anything(),
    );
  });

  it("a thrown renew carrying 408/429 KEEPS the assumed-live containment — transient by meaning, not deterministic", async () => {
    // 408 (timeout) and 429 (rate limit) are 4xx by status but TRANSIENT by
    // meaning: a retry can succeed, so evicting the lease (heartbeat stops,
    // sweeper reclaims a possibly-LIVE job) on a momentary rate-limit blip
    // would manufacture the exact false worker-crashed class the
    // assumed-live containment exists to prevent.
    const payload = samplePayload();
    const { pb } = makeFakePb([{ ...jobView({ id: "j1" }), payload }]);
    const claim = makeFakeClaim({
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({
            id: jobId,
            status: "claimed",
            claimed_by: workerId,
            lease_expires_at: "2026-06-04T00:01:00.000Z",
            version: 1,
          }),
        }),
      ),
      renewLease: vi.fn(async (): Promise<RenewResult> => {
        throw new JobClaimEndpointError(
          "/api/fleet/renew",
          429,
          "rate limited",
        );
      }),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    await q.claimNext("worker-7", 30);

    const kept = await q.renewLease("j1", "worker-7", 30);
    expect(kept).not.toBeNull();
    expect(kept?.leaseExpiresAt).toBe("2026-06-04T00:01:00.000Z");
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.renew-indeterminate",
      expect.objectContaining({ jobId: "j1" }),
    );
    expect(logger.error).not.toHaveBeenCalledWith(
      "queue-client.renew-rejected",
      expect.anything(),
    );
  });

  it("renew under PERSISTENT auth-400 (rotated creds) stops the heartbeat — end-to-end through the REAL job-claim client", async () => {
    // Integration pin for the rotated-credentials path: the session token is
    // invalidated, the renew 401s, postFleet re-auths, and the re-auth 400s.
    // The real job-claim client must surface that as the deterministic
    // JobClaimEndpointError class so the carve-out above fires — a plain
    // Error routed it down the indeterminate path FOREVER (phantom
    // assumed-live lease on every beat while the sweeper hands the job to
    // another worker).
    const payload = samplePayload();
    const { pb } = makeFakePb([{ ...jobView({ id: "j1" }), payload }]);
    let authCalls = 0;
    const fetchImpl = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = String(input);
      if (url.includes("auth-with-password")) {
        authCalls += 1;
        if (authCalls === 1) {
          return new Response(JSON.stringify({ token: "tok1" }), {
            status: 200,
          });
        }
        // Creds rotated after the claim: every later auth 400s.
        return new Response("invalid credentials", { status: 400 });
      }
      if (url.includes("/api/fleet/claim")) {
        const body = JSON.parse(String(init?.body)) as {
          jobId: string;
          workerId: string;
        };
        return new Response(
          JSON.stringify({
            claimed: true,
            job: jobView({
              id: body.jobId,
              status: "claimed",
              claimed_by: body.workerId,
              lease_expires_at: "2026-06-04T00:01:00.000Z",
              version: 1,
            }),
          }),
          { status: 200 },
        );
      }
      // The renew under the now-invalidated token: 401 → re-auth → 400.
      return new Response("token expired", { status: 401 });
    }) as unknown as typeof fetch;
    const claim = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "pw",
      logger,
      fetchImpl,
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const claimed = await q.claimNext("worker-7", 30);
    expect(claimed.claimed).toBe(true);

    const lost = await q.renewLease("j1", "worker-7", 30);
    expect(lost).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      "queue-client.renew-rejected",
      expect.objectContaining({ jobId: "j1", status: 400 }),
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      "queue-client.renew-indeterminate",
      expect.anything(),
    );
  });

  it("a thrown renew with NO locally-known lease still throws (nothing to assume-live from)", async () => {
    const { pb } = makeFakePb([
      { ...jobView({ id: "j1" }), payload: samplePayload() },
    ]);
    const claim = makeFakeClaim({
      renewLease: vi.fn(async (): Promise<RenewResult> => {
        throw new Error("renew transport blip");
      }),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    // No prior claim in this process → no cached lease to keep alive.
    await expect(q.renewLease("j1", "worker-7", 30)).rejects.toThrow(
      /renew transport blip/,
    );
  });

  it("returns a lease on a SUCCESSFUL CAS even when cache miss AND reread fail", async () => {
    // The CAS renewed (won), but there is NO prior same-process claim (cache
    // empty) AND the convenience re-read THROWS (PB blip). A successful CAS
    // renew must keep the heartbeat ALIVE — returning null here would make the
    // heartbeat misread a healthy renew as a lost lease, stop, and let the
    // sweeper reclaim a LIVE job → a FALSE worker-crashed. So renewLease must
    // still return a lease (best-effort empty payload from the CAS row); null
    // is reserved for a FAILED CAS only.
    const { pb } = makeFakePb([
      { ...jobView({ id: "j1" }), payload: samplePayload() },
    ]);
    pb.getOne = vi.fn(async () => {
      throw new Error("transient PB read blip");
    }) as PbClient["getOne"];
    const claim = makeFakeClaim({
      renewLease: vi.fn(
        async (): Promise<RenewResult> => ({
          renewed: true,
          job: jobView({
            id: "j1",
            probe_key: "d6:langgraph-python",
            status: "running",
            claimed_by: "worker-7",
            lease_expires_at: "2026-06-04T00:02:00.000Z",
            version: 2,
          }),
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    // No prior claimNext → payload cache is empty for j1.
    const lease = await q.renewLease("j1", "worker-7", 30);

    expect(lease).not.toBeNull();
    expect(lease?.job.status).toBe("running");
    expect(lease?.leaseExpiresAt).toBe("2026-06-04T00:02:00.000Z");
    // Best-effort payload carries the join key from the CAS row.
    expect(lease?.payload.probeKey).toBe("d6:langgraph-python");
  });
});

describe("FleetQueueClient.report", () => {
  /** A terminal-row seed so the post-release `pb.update` has a row to patch. */
  function seededRow(): JobRow {
    return { ...jobView({ id: "j1" }), payload: samplePayload() };
  }

  it("maps an all-green result to releaseJob(done)", async () => {
    const { pb } = makeFakePb([seededRow()]);
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({ releaseJob });
    const q = createFleetQueueClient({ pb, claim, logger });

    const input: ReportJobInput = {
      jobId: "j1",
      workerId: "worker-7",
      result: sampleResult(),
    };
    await q.report(input);

    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-7", "done");
  });

  it("maps a red aggregate to releaseJob(failed)", async () => {
    const { pb } = makeFakePb([seededRow()]);
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({ releaseJob });
    const q = createFleetQueueClient({ pb, claim, logger });

    await q.report({
      jobId: "j1",
      workerId: "worker-7",
      result: sampleResult({ aggregateState: "red" }),
    });

    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-7", "failed");
  });

  it("maps a comm-error result to releaseJob(failed) regardless of state", async () => {
    const { pb } = makeFakePb([seededRow()]);
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({ releaseJob });
    const q = createFleetQueueClient({ pb, claim, logger });

    await q.report({
      jobId: "j1",
      workerId: "worker-7",
      result: sampleResult({
        aggregateState: "green",
        commError: {
          kind: "worker-protocol-violation",
          message: "bad shape",
          observedAt: "2026-06-04T00:00:03.000Z",
        },
      }),
    });

    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-7", "failed");
  });

  it("throws on a ReportJobInput equality-invariant violation BEFORE releasing anything", async () => {
    // contracts.ts documents jobId === result.jobId and workerId ===
    // result.workerId as the input invariant: release keys on the top-level
    // ids while the persisted result echoes its own, so a mismatched caller
    // would release ONE row while filing the result under ANOTHER
    // job's/worker's ids. report() must fail loud before the release CAS.
    const { pb, rows } = makeFakePb([seededRow()]);
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({ releaseJob });
    const q = createFleetQueueClient({ pb, claim, logger });

    await expect(
      q.report({
        jobId: "j1",
        workerId: "worker-7",
        result: sampleResult({ jobId: "j2" }),
      }),
    ).rejects.toThrow(/equality invariant/i);
    await expect(
      q.report({
        jobId: "j1",
        workerId: "worker-7",
        result: sampleResult({ workerId: "worker-8" }),
      }),
    ).rejects.toThrow(/equality invariant/i);
    expect(releaseJob).not.toHaveBeenCalled();
    expect(rows[0].result).toBeUndefined();
  });

  it("does NOT evict the cached lease/payload on an equality-invariant rejection (the worker still holds the job)", async () => {
    // The invariant rejection is a MALFORMED-INPUT refusal thrown BEFORE the
    // release CAS — nothing was released, so the worker still legitimately
    // holds the job and its heartbeat keeps renewing. The finally's
    // unconditional eviction dropped the claim-time caches anyway, so the
    // very next INDETERMINATE renew (thrown claim.renewLease) found no
    // assumed-live lease to return and re-threw — killing the heartbeat and
    // letting the sweeper reclaim a LIVE job (the false
    // worker-crashed-mid-job class the caches exist to prevent).
    const payload = samplePayload();
    const { pb } = makeFakePb([{ ...jobView({ id: "j1" }), payload }]);
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({
      releaseJob,
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        }),
      ),
      renewLease: vi.fn(async (): Promise<RenewResult> => {
        throw new Error("transport blip — indeterminate renew");
      }),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const claimed = await q.claimNext("worker-7", 30);
    expect(claimed.claimed).toBe(true);

    await expect(
      q.report({
        jobId: "j1",
        workerId: "worker-7",
        result: sampleResult({ jobId: "j2" }),
      }),
    ).rejects.toThrow(/equality invariant/i);
    expect(releaseJob).not.toHaveBeenCalled();

    // The caches survived: the indeterminate renew returns the claim-time
    // lease ASSUMED-LIVE instead of re-throwing (heartbeat stays alive).
    const lease = await q.renewLease("j1", "worker-7", 30);
    expect(lease).not.toBeNull();
    expect(lease!.job.id).toBe("j1");
    expect(lease!.payload).toEqual(payload);
  });

  it("evicts the cached payload even when the result is MALFORMED (status computed inside the try)", async () => {
    // terminalJobStatus(input.result) used to run BEFORE the try/finally —
    // a malformed result threw past the finally and the claim-time cache
    // entry leaked (the same strand the finally exists to prevent: the
    // worker is done with the job either way). Proof of eviction: a later
    // successful renew must take the convenience RE-READ path (cache miss →
    // pb.getOne); a leaked entry would skip it.
    const payload = samplePayload();
    const { pb } = makeFakePb([{ ...jobView({ id: "j1" }), payload }]);
    const getOneSpy = vi.fn(pb.getOne.bind(pb));
    pb.getOne = getOneSpy as PbClient["getOne"];
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({
      releaseJob,
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        }),
      ),
      renewLease: vi.fn(
        async (): Promise<RenewResult> => ({
          renewed: true,
          job: jobView({
            id: "j1",
            status: "running",
            claimed_by: "worker-7",
            lease_expires_at: "2026-06-04T00:02:00.000Z",
            version: 2,
          }),
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    await q.claimNext("worker-7", 30);
    await expect(
      q.report({
        jobId: "j1",
        workerId: "worker-7",
        result: null as unknown as ServiceJobResult,
      }),
    ).rejects.toThrow();
    expect(releaseJob).not.toHaveBeenCalled();

    const lease = await q.renewLease("j1", "worker-7", 30);
    expect(lease).not.toBeNull();
    expect(getOneSpy).toHaveBeenCalledTimes(1);
  });

  it("persists the ServiceJobResult onto the row, unprocessed, after the release", async () => {
    const { pb, rows } = makeFakePb([seededRow()]);
    // ORDERING (non-vacuous): capture the row's result AT RELEASE TIME —
    // inside the releaseJob fake — and assert it was still unwritten. A
    // released-first boolean checked after the fact is vacuously true
    // whenever the release ran at all, regardless of write order.
    let resultAtRelease: unknown = "sentinel-not-read";
    const releaseJob = vi.fn(async (): Promise<ReleaseResult> => {
      resultAtRelease = rows[0].result;
      return { released: true };
    });
    const claim = makeFakeClaim({ releaseJob });
    const q = createFleetQueueClient({ pb, claim, logger });

    const result = sampleResult();
    await q.report({ jobId: "j1", workerId: "worker-7", result });

    // Nothing was written before (or during) the release CAS…
    expect(releaseJob).toHaveBeenCalledTimes(1);
    expect(resultAtRelease).toBeUndefined();
    // …and the control-plane consumer reads this back to aggregate exactly
    // once afterwards.
    expect(rows[0].result).toEqual(result);
    expect(rows[0].result_processed).toBe(false);
  });

  it("retries the result write, then throws a DISTINCT 'result lost' error when it keeps failing", async () => {
    // The release CAS SUCCEEDS (row is now terminal), but the SEPARATE result
    // write keeps failing. Giving up silently would DROP the result (terminal
    // row, no result → consumer latches it resultless, dashboard never
    // updates). report() must retry the write (bounded) and, when exhausted,
    // throw an error that DISTINGUISHES "release succeeded but result write
    // FAILED (result lost)" from a refused release.
    const { pb } = makeFakePb([seededRow()]);
    let updateAttempts = 0;
    pb.update = vi.fn(async () => {
      updateAttempts++;
      throw new Error("transient PB write blip");
    }) as PbClient["update"];
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({ releaseJob });
    // No-op sleep: this test pins the retry COUNT, not the pacing (pinned
    // separately below) — keep it instant.
    const q = createFleetQueueClient({
      pb,
      claim,
      logger,
      sleep: async () => {},
    });

    await expect(
      q.report({ jobId: "j1", workerId: "worker-7", result: sampleResult() }),
    ).rejects.toThrow(/result lost/i);
    // The release was attempted (and won) before the result write.
    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-7", "done");
    // The write was retried up to EXACTLY the production bound — pinned via
    // the imported constant so the test can't drift from the implementation.
    expect(updateAttempts).toBe(RESULT_WRITE_MAX_ATTEMPTS);
  });

  it("pauses between result-write retries (no hot-loop hammering a blipping PB)", async () => {
    // Back-to-back retries land inside the same transient blip window —
    // a small delay between attempts gives the blip time to clear. Pinned
    // via an injected sleep so the test is instant and exact: one pause
    // between each consecutive attempt pair (never after the last).
    const { pb } = makeFakePb([seededRow()]);
    pb.update = vi.fn(async () => {
      throw new Error("transient PB write blip");
    }) as PbClient["update"];
    const sleeps: number[] = [];
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({ released: true }),
      ),
    });
    const q = createFleetQueueClient({
      pb,
      claim,
      logger,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });

    await expect(
      q.report({ jobId: "j1", workerId: "worker-7", result: sampleResult() }),
    ).rejects.toThrow(/result lost/i);

    expect(sleeps).toEqual(
      Array(RESULT_WRITE_MAX_ATTEMPTS - 1).fill(RESULT_WRITE_RETRY_DELAY_MS),
    );
  });

  it("succeeds when the result write fails once then recovers (bounded retry)", async () => {
    const { pb, rows } = makeFakePb([seededRow()]);
    const realUpdate = pb.update.bind(pb);
    let updateAttempts = 0;
    pb.update = vi.fn(
      async (
        collection: string,
        id: string,
        record: Record<string, unknown>,
      ) => {
        updateAttempts++;
        if (updateAttempts === 1) throw new Error("transient blip");
        return realUpdate(collection, id, record);
      },
    ) as PbClient["update"];
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({ released: true }),
      ),
    });
    const q = createFleetQueueClient({
      pb,
      claim,
      logger,
      sleep: async () => {},
    });

    const result = sampleResult();
    await q.report({ jobId: "j1", workerId: "worker-7", result });

    expect(updateAttempts).toBe(2);
    expect(rows[0].result).toEqual(result);
    expect(rows[0].result_processed).toBe(false);
  });

  it("an intra-call write retry NEVER un-latches a committed-then-thrown first attempt (read-before-retry)", async () => {
    // COMMITTED-THEN-THROWN: write attempt 1 commits server-side, then the
    // response is lost (a thrown update). During the 250ms retry pause the
    // consumer can read the row, aggregate the result, and LATCH
    // result_processed: true. A blind attempt-2 rewrite re-seeds
    // result_processed: false — un-latching a result the consumer already
    // aggregated, which the consumer then aggregates a SECOND time. The
    // CROSS-call retry path guards exactly this with a read-before-write;
    // the INTRA-call retry loop must apply the same guard.
    const { pb, rows } = makeFakePb([seededRow()]);
    const realUpdate = pb.update.bind(pb);
    let updateAttempts = 0;
    pb.update = vi.fn(
      async (
        collection: string,
        id: string,
        record: Record<string, unknown>,
      ) => {
        updateAttempts++;
        if (updateAttempts === 1) {
          // COMMIT server-side, then lose the response.
          await realUpdate(collection, id, record);
          throw new Error("socket reset after commit");
        }
        return realUpdate(collection, id, record);
      },
    ) as PbClient["update"];
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({ released: true }),
      ),
    });
    const q = createFleetQueueClient({
      pb,
      claim,
      logger,
      // The consumer aggregates + latches INSIDE the retry pause window.
      sleep: async () => {
        rows[0].result_processed = true;
      },
    });

    const result = sampleResult();
    await q.report({ jobId: "j1", workerId: "worker-7", result });

    // Attempt 2 read the row, saw the committed result, and SKIPPED the
    // rewrite — exactly one update landed and the consumer's latch survives.
    expect(updateAttempts).toBe(1);
    expect(rows[0].result).toEqual(result);
    expect(rows[0].result_processed).toBe(true);
  });

  it("a failed pre-retry read refuses the blind rewrite (the retry is consumed, never a blind write)", async () => {
    // If the read-before-retry guard itself fails, a blind write could still
    // un-latch a committed first attempt — refuse it. The attempt is spent
    // (lastErr recorded); on exhaustion report() surfaces the distinct
    // result-lost error and stays retryable (the cross-call path re-reads).
    const { pb, rows } = makeFakePb([seededRow()]);
    const realUpdate = pb.update.bind(pb);
    let updateAttempts = 0;
    pb.update = vi.fn(
      async (
        collection: string,
        id: string,
        record: Record<string, unknown>,
      ) => {
        updateAttempts++;
        // Commit-then-throw on EVERY update call that happens.
        await realUpdate(collection, id, record);
        throw new Error("socket reset after commit");
      },
    ) as PbClient["update"];
    pb.getOne = vi.fn(async () => {
      throw new Error("read blip");
    }) as PbClient["getOne"];
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({ released: true }),
      ),
    });
    const q = createFleetQueueClient({
      pb,
      claim,
      logger,
      sleep: async () => {},
    });

    await expect(
      q.report({ jobId: "j1", workerId: "worker-7", result: sampleResult() }),
    ).rejects.toThrow(/result lost/i);

    // Only the FIRST attempt wrote; every retry's failed pre-read refused
    // the blind rewrite instead of re-seeding result_processed: false.
    expect(updateAttempts).toBe(1);
    expect(rows[0].result_processed).toBe(false);
  });

  it("does NOT persist a result when the release CAS is refused", async () => {
    const { pb, rows } = makeFakePb([seededRow()]);
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({
          released: false,
          reason: "refused_not_holder",
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    // The error must say what actually happened: the computed result IS
    // discarded, and the job re-runs ONLY if the sweeper reclaims it to
    // pending — a terminal row never re-runs (the old wording claimed an
    // unconditional re-run).
    await expect(
      q.report({ jobId: "j1", workerId: "worker-7", result: sampleResult() }),
    ).rejects.toThrow(
      /release refused .* result is DISCARDED.*re-runs only if .* reclaimed to pending/i,
    );
    // A refused release must never leave a result on a row this worker no
    // longer owns — the consumer would otherwise aggregate a stale result.
    expect(rows[0].result).toBeUndefined();
  });

  it("a refusal WITHOUT a reason (legacy hook) still throws (fail closed, not fail open)", async () => {
    const { pb, rows } = makeFakePb([seededRow()]);
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({ released: false }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    await expect(
      q.report({ jobId: "j1", workerId: "worker-7", result: sampleResult() }),
    ).rejects.toThrow(/release refused/i);
    expect(rows[0].result).toBeUndefined();
  });

  it("skips to the result write when the refusal is refused_terminal_same_holder (report() is retryable)", async () => {
    // TIMEOUT-AFTER-COMMIT retry truthfulness: report()'s first attempt can
    // succeed the release CAS and then exhaust the result write (throwing
    // "result lost"). A NATURAL RETRY of report() then gets the release
    // REFUSED — the row is already terminal — and used to emit the
    // "result is DISCARDED and the job re-runs" error: both halves false
    // (the result is still writable by this holder; terminal rows never
    // re-run). With the hook's reason field, a refusal that is
    // refused_terminal_same_holder (terminal UNDER MY workerId — only this
    // worker's own committed release can produce that) skips straight to
    // writeResult, making report() retryable end-to-end.
    const { pb, rows } = makeFakePb([seededRow()]);
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({
          released: false,
          reason: "refused_terminal_same_holder",
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const result = sampleResult();
    await q.report({ jobId: "j1", workerId: "worker-7", result });

    // The result landed for the consumer despite the refused (re-)release.
    expect(rows[0].result).toEqual(result);
    expect(rows[0].result_processed).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.release-refused-terminal-same-holder",
      expect.objectContaining({ jobId: "j1", workerId: "worker-7" }),
    );
  });

  it("a report() retry must NOT rewrite a result the consumer already AGGREGATED (no un-latch double-count)", async () => {
    // DOUBLE-COUNT GUARD (G1c): writeResult always writes
    // `result_processed: false`. On the refused_terminal_same_holder retry
    // path, the first attempt's result may ALREADY be on the row and already
    // aggregated (result_processed latched true by the consumer) — a blind
    // rewrite UN-LATCHES it and the consumer aggregates the same result a
    // second time. The retry must READ the row first and skip the write
    // entirely when a processed result is present.
    const aggregated = sampleResult();
    const row: JobRow = {
      ...jobView({ id: "j1", status: "done", claimed_by: "worker-7" }),
      payload: samplePayload(),
      result: aggregated,
      result_processed: true,
    };
    const { pb, rows } = makeFakePb([row]);
    const updateSpy = vi.fn(pb.update.bind(pb));
    pb.update = updateSpy as PbClient["update"];
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({
          released: false,
          reason: "refused_terminal_same_holder",
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    await q.report({
      jobId: "j1",
      workerId: "worker-7",
      result: sampleResult(),
    });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(rows[0].result).toEqual(aggregated);
    expect(rows[0].result_processed).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      "queue-client.result-already-aggregated",
      expect.objectContaining({ jobId: "j1", workerId: "worker-7" }),
    );
  });

  it("a report() retry skips the rewrite when a result is present but UNPROCESSED (idempotent)", async () => {
    // The first attempt's writeResult landed but its response (or the
    // release response before it) was lost. The result is already sitting
    // on the row awaiting aggregation — rewriting it is at best a no-op and
    // at worst races the consumer's latch (read result → aggregate → latch)
    // mid-flight. Skip it.
    const written = sampleResult();
    const row: JobRow = {
      ...jobView({ id: "j1", status: "done", claimed_by: "worker-7" }),
      payload: samplePayload(),
      result: written,
      result_processed: false,
    };
    const { pb, rows } = makeFakePb([row]);
    const updateSpy = vi.fn(pb.update.bind(pb));
    pb.update = updateSpy as PbClient["update"];
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({
          released: false,
          reason: "refused_terminal_same_holder",
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    await q.report({
      jobId: "j1",
      workerId: "worker-7",
      result: sampleResult(),
    });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(rows[0].result).toEqual(written);
    expect(rows[0].result_processed).toBe(false);
    expect(logger.info).toHaveBeenCalledWith(
      "queue-client.result-already-written",
      expect.objectContaining({ jobId: "j1", workerId: "worker-7" }),
    );
  });

  it("a report() retry whose pre-write read resolves NULL refuses to blind-write (G1g)", async () => {
    // pb.getOne resolves null for a missing/unreadable row — semantically a
    // FAILED read, not "no result present". Falling through to writeResult
    // on it is exactly the blind rewrite the guard exists to prevent (and
    // would resurrect a row the consumer may have deleted). Throw loud;
    // report() stays retryable.
    const { pb, rows } = makeFakePb([
      { ...jobView({ id: "j1" }), payload: samplePayload() },
    ]);
    pb.getOne = vi.fn(async () => null) as PbClient["getOne"];
    const updateSpy = vi.fn(pb.update.bind(pb));
    pb.update = updateSpy as PbClient["update"];
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({
          released: false,
          reason: "refused_terminal_same_holder",
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    await expect(
      q.report({ jobId: "j1", workerId: "worker-7", result: sampleResult() }),
    ).rejects.toThrow(/cannot verify existing result/i);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(rows[0].result).toBeUndefined();
  });

  it("a report() retry treats an EMPTY-STRING result as absent (PB unset-JSON shape) and completes the write (G1g)", async () => {
    // PB returns "" (not undefined/null) for an unset JSON column on some
    // read paths. The presence check treated "" as a written result and
    // SKIPPED the write — silently dropping the retry's result (terminal
    // resultless row → the consumer later synthesizes a false
    // worker-crashed-mid-job). "" must take the no-result leg: fall through
    // to writeResult (the original retryability contract).
    const row: JobRow = {
      ...jobView({ id: "j1", status: "done", claimed_by: "worker-7" }),
      payload: samplePayload(),
      result: "",
      result_processed: false,
    };
    const { pb, rows } = makeFakePb([row]);
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({
          released: false,
          reason: "refused_terminal_same_holder",
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const result = sampleResult();
    await q.report({ jobId: "j1", workerId: "worker-7", result });

    expect(rows[0].result).toEqual(result);
    expect(rows[0].result_processed).toBe(false);
  });

  it("a report() retry that cannot READ the row refuses to blind-write (throws, retryable)", async () => {
    // If the pre-write read blips, falling through to writeResult would be
    // exactly the blind rewrite the guard exists to prevent. Fail the retry
    // loud instead — report() stays retryable and the NEXT retry re-reads.
    const { pb, rows } = makeFakePb([
      { ...jobView({ id: "j1" }), payload: samplePayload() },
    ]);
    pb.getOne = vi.fn(async () => {
      throw new Error("pb read 502");
    }) as PbClient["getOne"];
    const updateSpy = vi.fn(pb.update.bind(pb));
    pb.update = updateSpy as PbClient["update"];
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({
          released: false,
          reason: "refused_terminal_same_holder",
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    await expect(
      q.report({ jobId: "j1", workerId: "worker-7", result: sampleResult() }),
    ).rejects.toThrow(/cannot verify existing result/i);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(rows[0].result).toBeUndefined();
  });
});

describe("FleetQueueClient.sweepExpired", () => {
  it("CONCURRENT sweepExpired calls share ONE in-flight sweep (multi-producer wiring over one client)", async () => {
    // runControlPlane wires FOUR family producers over ONE queue client, so
    // a cron overrun (or a local cron override) can overlap two producers'
    // sweep calls. The grace set protecting just-re-queued rows from the
    // stale phase is PER-CALL in-process state — a concurrent second sweep
    // cannot see it and could claim-delete a row the first sweep just
    // re-queued, falsifying its worker-reclaimed-pending comm error. The
    // client therefore latches: a sweep arriving while one is in flight
    // PIGGYBACKS on the in-flight sweep's result instead of racing it.
    const { pb } = makeFakePb([]);
    const realList = pb.list.bind(pb);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let listCalls = 0;
    pb.list = vi.fn(async (collection: string, opts?: ListOpts) => {
      listCalls += 1;
      await gate;
      return realList(collection, opts);
    }) as PbClient["list"];
    const q = createFleetQueueClient({
      pb,
      claim: makeFakeClaim(),
      logger,
      // Disable the stale drain so exactly ONE list per sweep (lease phase).
      stalePending: { expiryPeriods: 0 },
    });

    const nowMs = Date.parse("2026-06-04T00:05:00.000Z");
    const first = q.sweepExpired(nowMs);
    const second = q.sweepExpired(nowMs); // overlaps while first is gated
    release();
    const [r1, r2] = await Promise.all([first, second]);

    // ONE underlying sweep ran; the second caller shared its outcome.
    expect(listCalls).toBe(1);
    expect(r2).toBe(r1);

    // The latch CLEARS: a later (sequential) sweep runs for real.
    await q.sweepExpired(nowMs + 1);
    expect(listCalls).toBe(2);
  });

  it("reclaims expired leases and emits worker-reclaimed-pending comm errors (flap-band #70)", async () => {
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    // One running row with an EXPIRED lease (crashed worker), one with a live
    // lease that must NOT be swept.
    const expired: JobRow = {
      ...jobView({
        id: "j1",
        status: "running",
        claimed_by: "worker-dead",
        lease_expires_at: "2026-06-04T00:04:00.000Z",
        version: 3,
      }),
      payload: samplePayload(),
    };
    const live: JobRow = {
      ...jobView({
        id: "j2",
        status: "running",
        claimed_by: "worker-alive",
        lease_expires_at: "2026-06-04T00:06:00.000Z",
        version: 1,
      }),
      payload: samplePayload(),
    };
    const { pb } = makeFakePb([expired, live]);
    // The sweeper re-queues an expired row via S0 releaseJob(pending) on
    // behalf of the dead holder.
    const releaseJob = vi.fn(
      async (
        jobId: string,
        workerId: string,
        status: "done" | "failed" | "pending",
      ): Promise<ReleaseResult> => ({
        released: true,
        job: jobView({ id: jobId, status, claimed_by: "" }),
      }),
    );
    const claim = makeFakeClaim({ releaseJob });
    const q = createFleetQueueClient({ pb, claim, logger });

    const sweep = await q.sweepExpired(now);

    expect(sweep.reclaimed).toBe(1);
    // A clean CAS-confirmed release carries no at-least-once maybes (G1g).
    expect(sweep.reclaimedIndeterminate).toBe(0);
    expect(sweep.commErrors).toHaveLength(1);
    // flap-band #70: the sweep boundary cannot tell a real crash from an
    // expected platform teardown (both leave an identical expired lease), and
    // the job is RE-QUEUED to pending (back in flight), so the sweep emits the
    // NEUTRAL `worker-reclaimed-pending` kind — NOT `worker-crashed-mid-job`,
    // which would flap the service red on every routine teardown.
    expect(sweep.commErrors[0].kind).toBe("worker-reclaimed-pending");
    expect(sweep.commErrors[0].jobId).toBe("j1");
    expect(sweep.commErrors[0].workerId).toBe("worker-dead");
    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-dead", "pending");
    // The live lease must be untouched.
    expect(releaseJob).not.toHaveBeenCalledWith(
      "j2",
      expect.anything(),
      expect.anything(),
    );
  });

  it("does NOT reclaim a job renewed between the list snapshot and the release CAS (TOCTOU close)", async () => {
    const NOW = Date.parse("2026-06-04T00:05:00.000Z");
    // CURRENT row state: the worker RENEWED moments ago — live lease.
    const renewedRow: JobRow = {
      ...jobView({
        id: "j1",
        status: "running",
        claimed_by: "worker-live",
        lease_expires_at: "2026-06-04T00:06:00.000Z",
        version: 5,
      }),
      payload: samplePayload(),
    };
    const { pb, rows } = makeFakePb([renewedRow]);
    // The sweeper's list SNAPSHOT is stale: it observed the pre-renew lease
    // (expired) — the renew landed between the list and the release CAS.
    const realList = pb.list.bind(pb);
    pb.list = vi.fn(async (collection: string, opts?: ListOpts) => {
      const page = await realList(collection, opts);
      return {
        ...page,
        items: page.items.map((it) =>
          (it as JobRow).id === "j1"
            ? {
                ...(it as JobRow),
                lease_expires_at: "2026-06-04T00:04:00.000Z",
                version: 4,
              }
            : it,
        ),
      };
    }) as PbClient["list"];
    // Hook-faithful releaseJob (fleet-claim.pb.js /api/fleet/release):
    // authorizes on claimed_by AND — the TOCTOU close — refuses a
    // pending-target release while the row's CURRENT lease is still live,
    // re-checked at release time inside the transaction (NOT from the
    // caller's snapshot). Expiry compared via the exported leaseExpired so
    // this fake stays byte-equivalent with both sides of the contract.
    const releaseJob = vi.fn(
      async (
        jobId: string,
        workerId: string,
        status: "done" | "failed" | "pending",
      ): Promise<ReleaseResult> => {
        const row = rows.find((r) => r.id === jobId);
        if (!row || !["claimed", "running"].includes(row.status)) {
          return { released: false };
        }
        if (row.claimed_by !== workerId) return { released: false };
        if (status === "pending" && !leaseExpired(row.lease_expires_at, NOW)) {
          return { released: false };
        }
        row.status = status;
        row.claimed_by = "";
        // Hook-faithful: lease_expires_at is RETAINED on re-queue.
        return { released: true, job: { ...row } };
      },
    );
    const claim = makeFakeClaim({ releaseJob });
    const q = createFleetQueueClient({ pb, claim, logger });

    const sweep = await q.sweepExpired(NOW);

    // The release was ATTEMPTED (the stale snapshot looked expired)...
    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-live", "pending");
    // ...but REFUSED server-side, so the live just-renewed job is untouched:
    // no reclaim, no false worker-reclaimed-pending, no duplicate execution.
    expect(sweep.reclaimed).toBe(0);
    expect(sweep.commErrors).toHaveLength(0);
    expect(rows[0].status).toBe("running");
    expect(rows[0].claimed_by).toBe("worker-live");
    expect(rows[0].lease_expires_at).toBe("2026-06-04T00:06:00.000Z");
  });

  it("a releaseJob THROW on one row does not abort the sweep or lose other rows' comm errors (REQ-B)", async () => {
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    // Three expired leases; the MIDDLE row's release THROWS (transport blip,
    // not a refused CAS). Without per-row containment the throw escapes
    // sweepExpired, the producer's catch swallows it, and the comm errors
    // ALREADY synthesized for rows ALREADY released to pending are discarded —
    // their gray "re-queued" dashboard surfaces never render and are never
    // regenerated (the rows are pending now, so no later sweep re-emits them).
    const mkExpired = (id: string, worker: string): JobRow => ({
      ...jobView({
        id,
        status: "running",
        claimed_by: worker,
        lease_expires_at: "2026-06-04T00:04:00.000Z",
        version: 2,
      }),
      payload: samplePayload(),
    });
    const { pb } = makeFakePb([
      mkExpired("j1", "w1"),
      mkExpired("j2", "w2"),
      mkExpired("j3", "w3"),
    ]);
    const releaseJob = vi.fn(async (jobId: string): Promise<ReleaseResult> => {
      if (jobId === "j2") throw new Error("pb 502 mid-release");
      return { released: true };
    });
    const claim = makeFakeClaim({ releaseJob });
    const q = createFleetQueueClient({ pb, claim, logger });

    const sweep = await q.sweepExpired(now);

    // j1 (released BEFORE the throw) and j3 (after) both survive the blip,
    // and j2's throw is handled CONSERVATIVELY (timeout-after-commit): the
    // release may have committed server-side, so its comm error is
    // synthesized anyway (at-least-once — a duplicate gray overlay is
    // harmless, a missing one is lost forever). The split count (G1g) keeps
    // `reclaimed` exact (confirmed CAS releases only) while the maybe rides
    // `reclaimedIndeterminate`.
    expect(sweep.reclaimed).toBe(2);
    expect(sweep.reclaimedIndeterminate).toBe(1);
    expect(sweep.commErrors.map((e) => e.jobId)).toEqual(["j1", "j2", "j3"]);
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.sweep-release-threw",
      expect.objectContaining({ jobId: "j2", workerId: "w2" }),
    );
  });

  it("a thrown release carrying a DETERMINISTIC 4xx is NOT treated as may-have-committed (no false reclaim loop)", async () => {
    // G1d: the conservative thrown-release path assumed every throw might
    // have committed server-side. But a 4xx is the hook REJECTING the
    // request — deterministically NOTHING committed. The concrete trigger: a
    // wedge row with an EMPTY claimed_by — the sweep releases on behalf of
    // holder "" and the hook 400s (workerId required) — produced a PERMANENT
    // per-sweep false worker-reclaimed-pending overlay for a row that never
    // moved. A 4xx must log at error level and synthesize NOTHING: no grace,
    // no comm error, no reclaimed++.
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    const wedge: JobRow = {
      ...jobView({
        id: "j1",
        status: "running",
        claimed_by: "", // the wedge: no holder to authorize the re-queue
        lease_expires_at: "2026-06-04T00:04:00.000Z",
      }),
      payload: samplePayload(),
    };
    const { pb } = makeFakePb([wedge]);
    const claim = makeFakeClaim({
      releaseJob: vi.fn(async (): Promise<ReleaseResult> => {
        throw new JobClaimEndpointError(
          "/api/fleet/release",
          400,
          "jobId and workerId are required",
        );
      }),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const sweep = await q.sweepExpired(now);

    expect(sweep.reclaimed).toBe(0);
    expect(sweep.reclaimedIndeterminate).toBe(0);
    expect(sweep.commErrors).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith(
      "queue-client.sweep-release-rejected",
      expect.objectContaining({ jobId: "j1", status: 400 }),
    );
    // The conservative (may-have-committed) warn must NOT fire for a 4xx.
    expect(logger.warn).not.toHaveBeenCalledWith(
      "queue-client.sweep-release-threw",
      expect.anything(),
    );
  });

  it("a thrown release carrying a 5xx status KEEPS the conservative may-have-committed handling", async () => {
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    const expired: JobRow = {
      ...jobView({
        id: "j1",
        status: "running",
        claimed_by: "worker-dead",
        lease_expires_at: "2026-06-04T00:04:00.000Z",
      }),
      payload: samplePayload(),
    };
    const { pb } = makeFakePb([expired]);
    const claim = makeFakeClaim({
      releaseJob: vi.fn(async (): Promise<ReleaseResult> => {
        throw new JobClaimEndpointError(
          "/api/fleet/release",
          502,
          "bad gateway",
        );
      }),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const sweep = await q.sweepExpired(now);

    // 5xx is indeterminate — the release may have committed server-side, so
    // the comm error is synthesized anyway (at-least-once), counted on the
    // indeterminate counter rather than the confirmed one (G1g).
    expect(sweep.reclaimed).toBe(0);
    expect(sweep.reclaimedIndeterminate).toBe(1);
    expect(sweep.commErrors).toHaveLength(1);
    expect(sweep.commErrors[0].kind).toBe("worker-reclaimed-pending");
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.sweep-release-threw",
      expect.objectContaining({ jobId: "j1" }),
    );
  });

  it("a thrown release carrying 408/429 KEEPS the conservative may-have-committed handling — transient, not deterministic", async () => {
    // 408/429 are 4xx by status but transient by meaning — the SAME request
    // can succeed on retry, so the request was not deterministically
    // rejected and the at-least-once contract must hold (a missing gray
    // overlay is lost forever; a duplicate is harmless).
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    const expired: JobRow = {
      ...jobView({
        id: "j1",
        status: "running",
        claimed_by: "worker-dead",
        lease_expires_at: "2026-06-04T00:04:00.000Z",
      }),
      payload: samplePayload(),
    };
    const { pb } = makeFakePb([expired]);
    const claim = makeFakeClaim({
      releaseJob: vi.fn(async (): Promise<ReleaseResult> => {
        throw new JobClaimEndpointError("/api/fleet/release", 408, "timeout");
      }),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const sweep = await q.sweepExpired(now);

    expect(sweep.reclaimed).toBe(0);
    expect(sweep.reclaimedIndeterminate).toBe(1);
    expect(sweep.commErrors).toHaveLength(1);
    expect(sweep.commErrors[0].kind).toBe("worker-reclaimed-pending");
    expect(logger.warn).toHaveBeenCalledWith(
      "queue-client.sweep-release-threw",
      expect.objectContaining({ jobId: "j1" }),
    );
    expect(logger.error).not.toHaveBeenCalledWith(
      "queue-client.sweep-release-rejected",
      expect.anything(),
    );
  });

  it("sweep release under auth-400 (rotated creds) takes the DETERMINISTIC branch — end-to-end through the REAL job-claim client", async () => {
    // Integration pin for the sweep half of the rotated-credentials path: a
    // plain auth Error fell to the conservative may-have-committed handling,
    // synthesizing a FALSE worker-reclaimed-pending comm error on EVERY
    // sweep for a row the release can never move.
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    const expired: JobRow = {
      ...jobView({
        id: "j1",
        status: "running",
        claimed_by: "worker-dead",
        lease_expires_at: "2026-06-04T00:04:00.000Z",
      }),
      payload: samplePayload(),
    };
    const { pb } = makeFakePb([expired]);
    const fetchImpl = (async (
      input: string | URL | Request,
    ): Promise<Response> => {
      if (String(input).includes("auth-with-password")) {
        return new Response("invalid credentials", { status: 400 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const claim = createJobClaimClient({
      url: "http://pb",
      email: "a@b",
      password: "rotated-away",
      logger,
      fetchImpl,
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const sweep = await q.sweepExpired(now);

    expect(sweep.reclaimed).toBe(0);
    expect(sweep.reclaimedIndeterminate).toBe(0);
    expect(sweep.commErrors).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith(
      "queue-client.sweep-release-rejected",
      expect.objectContaining({ jobId: "j1", status: 400 }),
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      "queue-client.sweep-release-threw",
      expect.anything(),
    );
  });

  it("a THROW in the stale-pending phase still returns the lease phase's partial result (REQ-B)", async () => {
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    const expired: JobRow = {
      ...jobView({
        id: "j1",
        status: "running",
        claimed_by: "worker-dead",
        lease_expires_at: "2026-06-04T00:04:00.000Z",
      }),
      payload: samplePayload(),
    };
    const { pb } = makeFakePb([expired]);
    // The stale phase's pending list THROWS (PB blip). The lease phase's
    // reclaim + comm error must still come back to the producer — losing them
    // here is the same REQ-B hole as the per-row release throw above.
    const realList = pb.list.bind(pb);
    pb.list = vi.fn(async (collection: string, opts?: ListOpts) => {
      if (opts?.filter?.includes('status = "pending"')) {
        throw new Error("pb list 502");
      }
      return realList(collection, opts);
    }) as PbClient["list"];
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({ released: true }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const sweep = await q.sweepExpired(now);

    expect(sweep.reclaimed).toBe(1);
    expect(sweep.commErrors).toHaveLength(1);
    expect(sweep.commErrors[0].jobId).toBe("j1");
    expect(sweep.expiredPending).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      "queue-client.sweep-stale-phase-threw",
      expect.objectContaining({ err: "pb list 502" }),
    );
  });

  it("reports nothing reclaimed when no leases are expired", async () => {
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    const live: JobRow = {
      ...jobView({
        id: "j2",
        status: "running",
        claimed_by: "worker-alive",
        lease_expires_at: "2026-06-04T00:06:00.000Z",
      }),
      payload: samplePayload(),
    };
    const { pb } = makeFakePb([live]);
    const claim = makeFakeClaim();
    const q = createFleetQueueClient({ pb, claim, logger });

    const sweep = await q.sweepExpired(now);

    expect(sweep.reclaimed).toBe(0);
    expect(sweep.commErrors).toHaveLength(0);
    expect(claim.releaseJob).not.toHaveBeenCalled();
  });
});

describe("FleetQueueClient.pruneAged", () => {
  const NOW = Date.parse("2026-06-10T00:00:00.000Z");
  /** An ISO `created` stamp `ageMs` in the past relative to NOW. */
  const createdAgo = (ageMs: number): string =>
    new Date(NOW - ageMs).toISOString();
  const DAY_MS = 24 * 3600_000;
  const HOUR_MS = 3600_000;

  function prunableRow(overrides: Partial<JobRow>): JobRow {
    return { ...jobView(), payload: samplePayload(), ...overrides };
  }

  it("deletes terminal rows older than 14 days including result_processed=false poison rows", async () => {
    const { pb, rows, deleteFilters } = makeFakePb([
      // Poison row: terminal but the aggregator could never process its
      // result (`result_processed` stuck false). §4.2: the latch gates
      // aggregation, NOT retention — at 14 days the consume-once question is
      // moot and the row is reaped like any other terminal row.
      prunableRow({
        id: "j1",
        status: "done",
        created: createdAgo(15 * DAY_MS),
        result_processed: false,
      }),
      prunableRow({
        id: "j2",
        status: "failed",
        created: createdAgo(20 * DAY_MS),
        result_processed: true,
      }),
      // Younger terminal row — inside the 14-day window, must survive.
      prunableRow({
        id: "j3",
        status: "done",
        created: createdAgo(13 * DAY_MS),
        result_processed: true,
      }),
    ]);
    const q = createFleetQueueClient({ pb, claim: makeFakeClaim(), logger });

    const pruned = await q.pruneAged(NOW);

    expect(pruned).toEqual({ terminal: 2, zombie: 0 });
    expect(rows.map((r) => r.id)).toEqual(["j3"]);
    // §4.2: retention is deliberately blind to the aggregation latch — the
    // terminal-leg filter must NOT carry a result_processed clause.
    const terminalFilter = deleteFilters.find((f) => f.includes('"done"'));
    expect(terminalFilter).toBeDefined();
    expect(terminalFilter).not.toContain("result_processed");
  });

  it("deletes non-terminal rows older than 48 hours (zombie leg)", async () => {
    // Nothing else ever reaps abandoned pending/claimed/running rows: a
    // pending row has no lease for sweepExpired to expire, and the terminal
    // leg only touches done/failed. All three non-terminal states are reaped
    // past the 48 h zombie window.
    const { pb, rows } = makeFakePb([
      prunableRow({
        id: "j1",
        status: "pending",
        created: createdAgo(49 * HOUR_MS),
      }),
      prunableRow({
        id: "j2",
        status: "claimed",
        claimed_by: "worker-dead",
        created: createdAgo(72 * HOUR_MS),
      }),
      prunableRow({
        id: "j3",
        status: "running",
        claimed_by: "worker-dead",
        created: createdAgo(50 * HOUR_MS),
      }),
    ]);
    const q = createFleetQueueClient({ pb, claim: makeFakeClaim(), logger });

    const pruned = await q.pruneAged(NOW);

    expect(pruned).toEqual({ terminal: 0, zombie: 3 });
    expect(rows).toHaveLength(0);
  });

  it("leaves younger non-terminal (stalled-but-within-window) rows untouched", async () => {
    // A stalled batch keeps its full ~2-day diagnostic window rendering as
    // `stalled` on the Ops tab — the zombie leg must never reap rows the
    // stalled-classification window still owns. The cutoff keys on `created`
    // (renewal-immune), not `updated`.
    const { pb, rows } = makeFakePb([
      prunableRow({
        id: "j1",
        status: "pending",
        created: createdAgo(47 * HOUR_MS),
      }),
      prunableRow({
        id: "j2",
        status: "running",
        claimed_by: "worker-7",
        created: createdAgo(2 * HOUR_MS),
      }),
    ]);
    const q = createFleetQueueClient({ pb, claim: makeFakeClaim(), logger });

    const pruned = await q.pruneAged(NOW);

    expect(pruned).toEqual({ terminal: 0, zombie: 0 });
    expect(rows.map((r) => r.id)).toEqual(["j1", "j2"]);
  });

  it("computes both cutoffs from the exported window constants", () => {
    // T15 and the route tests reference these — pin the §4.2 windows.
    expect(PRUNE_TERMINAL_MAX_AGE_MS).toBe(14 * DAY_MS);
    expect(PRUNE_ZOMBIE_MAX_AGE_MS).toBe(48 * HOUR_MS);
  });
});

describe("leaseExpired (anchored PB date-separator parse)", () => {
  const now = Date.parse("2026-06-04T00:05:00.000Z");

  it("treats null/empty as expired (never wedge the queue)", () => {
    expect(leaseExpired(null, now)).toBe(true);
    expect(leaseExpired("", now)).toBe(true);
  });

  it("parses the canonical PB space-separated form (expired in the past)", () => {
    // PB stores dates as "YYYY-MM-DD HH:MM:SS.sssZ" (space separator). The
    // anchored rewrite converts the date/time boundary so the value parses.
    expect(leaseExpired("2026-06-04 00:04:00.000Z", now)).toBe(true);
  });

  it("parses the canonical PB space-separated form (live in the future)", () => {
    expect(leaseExpired("2026-06-04 00:06:00.000Z", now)).toBe(false);
  });

  it("parses an already-ISO ('T'-separated) value unchanged", () => {
    expect(leaseExpired("2026-06-04T00:06:00.000Z", now)).toBe(false);
  });

  it("ANCHORS the space rewrite to the date/time boundary, not the FIRST space anywhere (string-level pin)", () => {
    // Pinned at the STRING level, NOT through Date.parse: the discriminating
    // input for the anchoring (a non-canonical shape like a leading-space
    // value) is exactly where V8 and goja — the PB JSVM — DIVERGE in parse
    // leniency (V8 parses " 2099-01-01 00:00:00.000Z" leniently; goja's
    // stricter Date.parse returns NaN). A Date.parse-based assertion here
    // would pin V8-specific behavior the hook does not share. The string
    // rewrite itself IS engine-independent and is the byte-equivalent
    // contract with the hook's `/^(\d{4}-\d{2}-\d{2}) /` anchor.
    //
    // RESIDUAL ENGINE DIVERGENCE (acknowledged, not closable here): after the
    // anchored rewrite leaves a non-canonical value untouched, V8 may still
    // parse it (→ live) where goja yields NaN (→ expired-by-policy). Such a
    // value can only come from a corrupted/hand-written lease column — the
    // canonical PB date form and the ISO form parse identically in both.
    // Canonical PB shape: ONLY the date/time-boundary space is rewritten.
    expect("2026-06-04 00:04:00.000Z".replace(PB_DATE_SEP_RE, "$1T")).toBe(
      "2026-06-04T00:04:00.000Z",
    );
    // Non-canonical (leading space): NOT anchored at `^YYYY-MM-DD ` — left
    // UNTOUCHED. A bare String.replace(" ", "T") would have produced
    // "T2099-01-01 00:00:00.000Z" (mangled); this FAILS under a bare replace.
    expect(" 2099-01-01 00:00:00.000Z".replace(PB_DATE_SEP_RE, "$1T")).toBe(
      " 2099-01-01 00:00:00.000Z",
    );
    // Already-ISO value: no space at the boundary, untouched.
    expect("2026-06-04T00:06:00.000Z".replace(PB_DATE_SEP_RE, "$1T")).toBe(
      "2026-06-04T00:06:00.000Z",
    );
  });

  it("treats a genuinely-unparseable value as expired (NaN → expired, not coerced)", () => {
    // An odd shape falls through to NaN → expired BY POLICY (never wedge the
    // queue) — but only because it genuinely failed to parse, NOT because a
    // bare first-space replace mangled it into something parseable. Both V8
    // and goja agree this input is unparseable (the anchored rewrite yields
    // "2099-01-01Tgarbage").
    expect(leaseExpired("2099-01-01 garbage", now)).toBe(true);
  });

  it("treats a lease expiring EXACTLY at nowMs as EXPIRED (boundary: <=, matching the hook)", () => {
    // Shared fixture with the JSVM hook's semantics: BOTH sides compare with
    // `t <= now` (client `t <= nowMs`; hook `t <= Date.now()` — operator
    // parity is pinned against the hook source below), so a lease elapsing at
    // exactly the observation millisecond is reclaimable on both sides. A
    // `<`/`<=` mismatch would open a 1ms window where the client reclaims a
    // row the hook still treats as live (or vice versa).
    const expiry = "2026-06-04 00:05:00.000Z"; // canonical PB space form
    const expiryMs = Date.parse("2026-06-04T00:05:00.000Z");
    expect(leaseExpired(expiry, expiryMs)).toBe(true); // t <= now → expired
    expect(leaseExpired(expiry, expiryMs - 1)).toBe(false); // 1ms early → live
  });
});

describe("fleet-claim.pb.js hook parity (client ↔ JSVM contract pins)", () => {
  // The client's leaseExpired and the hook's leaseExpired must agree BYTE FOR
  // BYTE on the anchored date rewrite and on the comparison operator — the
  // exactly-one-winner CAS depends on both sides deciding "expired" the same
  // way. The hook runs under goja (untestable from vitest), so these pins
  // assert against the hook SOURCE the deploy actually ships.
  const hookSource = readFileSync(
    fileURLToPath(
      new URL(
        "../../../pocketbase/pb_hooks/fleet-claim.pb.js",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  it("every handler embeds the SAME anchored date-separator regex as the client", () => {
    // PB_DATE_SEP_RE.source is the canonical anchor; the hook defines it
    // inline per handler (PB 0.22 pooled-runtime gotcha), 3 handlers.
    const occurrences = hookSource.split(PB_DATE_SEP_RE.source).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });

  it("every handler compares lease expiry with the client's operator (t <= now)", () => {
    const occurrences = hookSource.split("t <= Date.now()").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });

  it("every routerAdd endpoint carries the superuser auth middleware (requireAdminAuth)", () => {
    // SECURITY: the header contract says "superuser/worker auth required",
    // and the client (job-claim.ts) already authenticates as superuser with
    // a 401-reauth retry — but middleware-less routerAdd handlers are
    // PUBLIC in PB 0.22. Every endpoint must append
    // `$apis.requireAdminAuth()` (the PB 0.22 JSVM superuser-auth echo
    // middleware) or any unauthenticated caller can claim/renew/release
    // arbitrary jobs.
    const routes = hookSource.match(/routerAdd\(/g) ?? [];
    expect(routes.length).toBe(3);
    // Match the MIDDLEWARE POSITION (the handler-closing `}, $apis...);`),
    // not bare mentions — the header comment also names the middleware.
    // Tolerant of formatter line-wrapping: the formatter may render the
    // closing as `}, $apis.requireAdminAuth());` (single-line) or as
    // `},\n  $apis.requireAdminAuth(),\n);` (split across lines). Both are
    // the same routerAdd-with-middleware closer.
    const guarded =
      hookSource.match(/\},\s*\$apis\.requireAdminAuth\(\)\s*[,)]\s*\)?;?/g) ??
      [];
    expect(guarded.length).toBe(3);
  });

  it("claim + renew clamp leaseSeconds (numeric, ceiling 3600, default 30 on garbage)", () => {
    // A malformed/hostile leaseSeconds must not wedge a row behind a
    // multi-day lease (ceiling) nor produce NaN expiries (numeric check →
    // 30s default). Pinned at the source level for both lease-setting
    // handlers (claim + renew; release sets no lease).
    const clamps = hookSource.match(/Math\.min\(\s*n,\s*3600\s*\)/g) ?? [];
    expect(clamps.length).toBe(2);
  });

  it("claim + renew clamp leaseSeconds on the LOW side too (floor 1s — no 1ms thrash leases)", () => {
    // n > 0 admits 0.001 → a 1ms lease: instantly expired, every claim
    // immediately stealable, renew thrash. Both lease-setting handlers must
    // floor the clamped value at 1 second.
    const floors =
      hookSource.match(
        /Math\.max\(\s*1,\s*Math\.min\(\s*n,\s*3600\s*\)\s*\)/g,
      ) ?? [];
    expect(floors.length).toBe(2);
  });

  it("the release handler REQUIRES an explicit status (no silent default to done)", () => {
    // `data.status || "done"` silently finished a job whose caller omitted
    // (or sent an empty) status — a protocol bug masked as success. Status
    // must be validated like jobId/workerId: explicit 400 when absent.
    expect(hookSource).not.toContain('data.status || "done"');
    expect(hookSource).toMatch(/status is required/);
  });

  it("every handler rejects a non-string workerId (a JSON number would coerce into the text column)", () => {
    // PB coerces a numeric workerId into the text claimed_by column, but the
    // holder then renews/releases with the STRING form — `claimed_by !==
    // workerId` never matches and the row is wedged until lease expiry.
    const guards = hookSource.match(/typeof workerId !== "string"/g) ?? [];
    expect(guards.length).toBe(3);
  });

  it("every handler rejects a non-string jobId (consistency with the workerId guard) — G1g", () => {
    // `!jobId` admits a truthy non-string (a JSON number/object); the
    // workerId guard rejects exactly that class for the text column, and
    // jobId feeds findRecordById the same way — a numeric jobId must 400 at
    // the boundary, not depend on the dao's coercion behavior.
    const guards = hookSource.match(/typeof jobId !== "string"/g) ?? [];
    expect(guards.length).toBe(3);
  });

  it("the claim handler returns an alreadyHeld marker for a same-holder live-lease re-claim (timeout-after-commit idempotency)", () => {
    // A claim that COMMITTED whose response was lost is retried by the same
    // worker; without idempotency the retry sees claimed:false (its own
    // live claim is not reclaimable) and abandons a row it actually holds.
    // The hook must answer claimed:true + alreadyHeld:true for a re-claim
    // by the CURRENT holder while the lease is live.
    expect(hookSource).toContain("alreadyHeld");
    expect(hookSource).toMatch(
      /rec\.get\("claimed_by"\) === workerId\s*&&\s*\n?\s*!leaseExpired\(rec\)/,
    );
  });

  it("the release handler reports a refusal reason (terminal-same-holder vs not-holder vs live-lease)", () => {
    // report()'s retryability depends on distinguishing "the row is terminal
    // under MY workerId" (my own earlier release committed → the result is
    // still mine to write) from every other refusal. The hook must emit the
    // reason on the released:false response.
    expect(hookSource).toContain('"refused_terminal_same_holder"');
    expect(hookSource).toContain('"refused_not_holder"');
    expect(hookSource).toContain('"refused_lease_live"');
    expect(hookSource).toContain("{ released: false, reason:");
  });

  it("the release handler RETAINS lease_expires_at on a pending re-queue (last-in-flight marker)", () => {
    // The stale-pending sweep's recent-lease heuristic depends on the
    // re-queue keeping the expired lease around: nulling it would let the
    // NEXT sweep claim-delete a re-queued long-runner off its original
    // `created` age. Claim admits pending rows regardless of lease, so
    // retention is safe.
    expect(hookSource).not.toContain('rec.set("lease_expires_at", null)');
  });

  it("the release handler re-checks lease expiry for a pending-target (sweeper) release — TOCTOU close", () => {
    // The sweeper decides "expired" from a LISTED SNAPSHOT, then releases on
    // behalf of the holder; the release CAS authorizes on `claimed_by`, which
    // a holder that RENEWED between the list and the release still matches.
    // Without a server-side re-check the renewed (LIVE) job is yanked back to
    // pending — duplicate execution plus a false worker-reclaimed-pending
    // comm error. The hook must refuse a pending-target release while the
    // row's CURRENT lease is still live, inside the same transaction.
    expect(hookSource).toContain(
      'if (target === "pending" && !leaseExpired(rec)) {',
    );
  });
});

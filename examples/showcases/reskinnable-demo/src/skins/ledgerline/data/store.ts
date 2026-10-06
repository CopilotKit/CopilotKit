/**
 * Ledgerline's server-side expense ledger: in memory, pinned on `globalThis`
 * so a dev-server module reload (and every route bundle) shares one copy.
 * `/api/ledgerline/v1/*`, the MCP server and the agent's tools all read and
 * write this same state.
 *
 * Refusals throw a `LedgerError` with a stable code; `http.ts` maps codes to
 * statuses. The POL-114 refusal names the hold code only, never the fix.
 */

import {
  COMPANY,
  COST_CENTERS,
  CURRENT_USER,
  EMPLOYEES,
  POLICY_DOCS,
  addDays,
  buildActivity,
  buildSeed,
  isoDate,
} from "./seed";
import type {
  Activity,
  ExpenseReport,
  Ledger,
  PolicyDoc,
  ReportStatus,
} from "./types";
import { HOLD_TEAM_EVENT } from "./types";
import { evaluateTeamEvent } from "./policy";
import { reset as resetRecon } from "./recon-store";
import type { PolicyCheck } from "./policy";

export class LedgerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

interface State {
  reports: ExpenseReport[];
  activity: Activity[];
  version: number;
  noteCounter: number;
}

const KEY = Symbol.for("ledgerline.store.v1");
type Pinned = typeof globalThis & { [KEY]?: State };

const today = () => isoDate(new Date());

function materialize(): State {
  const reports = buildSeed(today());
  return {
    reports,
    activity: buildActivity(reports),
    version: 1,
    noteCounter: 1,
  };
}

function state(): State {
  const g = globalThis as Pinned;
  g[KEY] ??= materialize();
  return g[KEY]!;
}

export function reset(): void {
  (globalThis as Pinned)[KEY] = materialize();
  // The month-end card close resets with the ledger. (recon-store imports
  // LedgerError from here; both sides only use the other inside functions.)
  resetRecon();
}

const clone = <T>(v: T): T => structuredClone(v);

function bump() {
  state().version += 1;
}

function log(
  kind: Activity["kind"],
  r: ExpenseReport,
  actor: string,
  text: string,
) {
  const s = state();
  s.activity.unshift({
    id: `A-${s.version}-${kind}-${r.id}`,
    at: new Date().toISOString(),
    actor,
    kind,
    reportId: r.id,
    text,
  });
  if (s.activity.length > 200) s.activity.length = 200;
}

export function version(): number {
  return state().version;
}

export function snapshot(): Ledger {
  return {
    today: today(),
    company: COMPANY,
    currentUser: CURRENT_USER,
    employees: EMPLOYEES,
    costCenters: COST_CENTERS,
    reports: clone(state().reports),
    activity: clone(state().activity.slice(0, 60)),
    version: state().version,
  };
}

function find(id: string): ExpenseReport {
  const needle = id.trim().toUpperCase();
  const r = state().reports.find(
    (x) => x.id === needle || x.id === `EXP-${needle}`,
  );
  if (!r)
    throw new LedgerError("NOT_FOUND", `There is no expense report ${id}.`);
  return r;
}

export function getReport(id: string): ExpenseReport {
  return clone(find(id));
}

export interface ReportQuery {
  status?: ReportStatus | "all";
  employee?: string;
  q?: string;
}

export function listReports(query: ReportQuery = {}): ExpenseReport[] {
  const emp = query.employee?.trim().toLowerCase();
  const q = query.q?.trim().toLowerCase();
  return clone(
    state()
      .reports.filter((r) =>
        !query.status || query.status === "all"
          ? true
          : r.status === query.status,
      )
      .filter((r) => (emp ? r.employeeName.toLowerCase().includes(emp) : true))
      .filter((r) =>
        q
          ? `${r.id} ${r.title} ${r.employeeName} ${r.category}`
              .toLowerCase()
              .includes(q)
          : true,
      )
      .sort(
        (a, b) =>
          b.submittedAt.localeCompare(a.submittedAt) ||
          b.id.localeCompare(a.id),
      ),
  );
}

export function approveReport(
  id: string,
  by = CURRENT_USER.name,
): ExpenseReport {
  const r = find(id);
  if (r.status === "approved" || r.status === "reimbursed") {
    throw new LedgerError("ALREADY_APPROVED", `${r.id} is already approved.`);
  }
  if (r.status !== "submitted") {
    throw new LedgerError(
      "NOT_SUBMITTED",
      `${r.id} is ${r.status} and cannot be approved.`,
    );
  }
  const open = r.holds.find((h) => h.status === "open");
  if (open) {
    throw new LedgerError(
      "POLICY_HOLD",
      `${r.id} cannot be approved: policy hold ${open.code} (allocation required) is open.`,
      { code: open.code },
    );
  }
  r.status = "approved";
  r.approvedAt = today();
  r.approvedBy = by;
  log("approved", r, by, `approved ${r.title}`);
  bump();
  return clone(r);
}

export interface LineCoding {
  lineId: string;
  costCenterId: string;
}

/**
 * Recode report lines to other cost centers. The policy engine re-evaluates
 * POL-114 on every recode: the hold resolves only when the event lines sit on
 * the events budget and nothing else does, and it reopens if a later recode
 * breaks that. Returns the report and the check (whose `reason` is for the
 * person in the app; the agent's view drops it).
 */
export function recodeLines(
  id: string,
  changes: LineCoding[],
): { report: ExpenseReport; check: PolicyCheck } {
  const r = find(id);
  if (r.status === "reimbursed" || r.status === "approved") {
    throw new LedgerError(
      "LOCKED",
      `${r.id} is ${r.status}; its coding is locked.`,
    );
  }
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new LedgerError("BAD_REQUEST", "Name at least one line to recode.");
  }
  const moves: { line: string; from: string; to: string }[] = [];
  for (const c of changes) {
    const line = r.lines.find(
      (l) => l.id.toUpperCase() === String(c.lineId).trim().toUpperCase(),
    );
    if (!line)
      throw new LedgerError("NOT_FOUND", `${r.id} has no line ${c.lineId}.`);
    const cc = COST_CENTERS.find(
      (x) => x.id.toUpperCase() === String(c.costCenterId).trim().toUpperCase(),
    );
    if (!cc)
      throw new LedgerError(
        "UNKNOWN_COST_CENTER",
        `${c.costCenterId} is not a cost center.`,
      );
    if (line.costCenterId !== cc.id)
      moves.push({
        line: line.description,
        from: line.costCenterId,
        to: cc.id,
      });
    line.costCenterId = cc.id;
  }
  const check = evaluateTeamEvent(r);
  for (const h of r.holds) {
    if (h.code !== HOLD_TEAM_EVENT) continue;
    if (check.status === "resolved" && h.status === "open") {
      h.status = "resolved";
      h.resolvedAt = today();
    } else if (check.status === "open" && h.status === "resolved") {
      h.status = "open";
      delete h.resolvedAt;
    }
  }
  if (moves.length) {
    log(
      "recoded",
      r,
      CURRENT_USER.name,
      `recoded ${moves.map((m) => `${m.line} to ${m.to}`).join(", ")}`,
    );
  }
  bump();
  return { report: clone(r), check };
}

export function reimburseReport(id: string): ExpenseReport {
  const r = find(id);
  if (r.status === "reimbursed") {
    throw new LedgerError(
      "ALREADY_REIMBURSED",
      `${r.id} has already been reimbursed.`,
    );
  }
  if (r.status !== "approved") {
    throw new LedgerError(
      "NOT_APPROVED",
      `${r.id} must be approved before it can be reimbursed.`,
    );
  }
  r.status = "reimbursed";
  r.reimbursement = {
    scheduledFor: nextFriday(today()),
    method: "ACH",
    reference: `ACH-${Number(r.id.replace(/\D/g, "")) + 60000}`,
  };
  log(
    "reimbursed",
    r,
    CURRENT_USER.name,
    `scheduled ACH reimbursement to ${r.employeeName}`,
  );
  bump();
  return clone(r);
}

export function addNote(
  id: string,
  text: string,
  author = CURRENT_USER.name,
): ExpenseReport {
  const r = find(id);
  const t = text.trim();
  if (t.length < 3)
    throw new LedgerError("INVALID_NOTE", "A note needs some text.");
  const s = state();
  r.notes.push({
    id: `N-${s.noteCounter++}`,
    at: new Date().toISOString(),
    author,
    text: t.slice(0, 1000),
  });
  log("note", r, author, `added a note to ${r.title}`);
  bump();
  return clone(r);
}

/**
 * Keyword search over the policy library. Deliberately generic: the library
 * describes holds in general and never names what clears a specific code.
 */
export function searchPolicies(query: string): {
  query: string;
  results: PolicyDoc[];
  note?: string;
} {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length > 2);
  const scored = POLICY_DOCS.map((d) => {
    const hay = `${d.title} ${d.section} ${d.summary} ${d.body}`.toLowerCase();
    return { d, score: words.filter((w) => hay.includes(w)).length };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.d);
  const codeLike = /\b[a-z]{2,4}-\d{2,4}\b/i.exec(query)?.[0];
  const results = scored.length
    ? scored
    : POLICY_DOCS.filter((d) => d.id === "AP-3.1");
  return {
    query,
    results,
    note:
      codeLike &&
      !POLICY_DOCS.some((d) => d.id.toLowerCase() === codeLike.toLowerCase())
        ? `No policy document is filed under ${codeLike.toUpperCase()}. Hold codes are issued by the policy engine, not the policy library.`
        : undefined,
  };
}

export function nextFriday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(y!, m! - 1, d!).getDay();
  const delta = (5 - dow + 7) % 7 || 7;
  return addDays(iso, delta);
}

/**
 * Rowan's server-side ledger.
 *
 * An in-memory module, exactly like `src/skins/banking/data/store.ts`: state
 * lives for the life of the Node process and `reset()` re-materializes it from
 * the seed. Every `/api/people/v1/*` route reads and writes through here, which
 * is what makes beat 3d true — a filed onboarding packet belongs to the
 * APPLICATION, so deleting the chat thread cannot take it away.
 *
 * Mutations that can legitimately be refused throw an Error whose `message` is
 * a stable CODE (`NOT_FOUND`, `OUT_OF_BAND`, `INVALID_EXCEPTION_CODE`, …). The
 * routes map those codes onto HTTP statuses; nothing parses prose.
 */

import { isJustifying, isValidExceptionCode } from "./band-exception-codes";
import {
  DEFAULT_OPERATOR_ID,
  SEED_BANDS,
  SEED_COMP_REQUESTS,
  SEED_EMPLOYEES,
  SEED_ONBOARDING_TASKS,
  SEED_OPERATORS,
  SEED_PACKETS,
  SEED_REQUESTS,
} from "./seed";
import type {
  Band,
  BandException,
  BandPosition,
  CompRequest,
  Employee,
  Level,
  OnboardingPacket,
  OnboardingTask,
  Operator,
  PeopleRequest,
  PeopleStoreState,
  RequestStatus,
} from "./types";

export { DEFAULT_OPERATOR_ID };

const DAY_MS = 86_400_000;
const AVG_MONTH_DAYS = 30.44;

/** `YYYY-MM-DD`, n months before now. Negative n is in the future. */
function monthsAgoDate(months: number): string {
  const d = new Date(Date.now() - months * AVG_MONTH_DAYS * DAY_MS);
  return d.toISOString().slice(0, 10);
}

/** Full ISO timestamp, n days before now. */
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/** Whole days between an ISO timestamp and now. Never negative. */
export function ageInDays(iso: string): number {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS),
  );
}

/**
 * Turn the relative-offset seed into dated records. Called at module init and
 * again on every `reset()`, so a presenter Reset re-freshens request aging
 * rather than restoring timestamps that were already stale.
 */
function materialize(): PeopleStoreState {
  return {
    bands: SEED_BANDS.map((b) => ({ ...b })),
    employees: SEED_EMPLOYEES.map((e) => ({
      id: e.id,
      name: e.name,
      title: e.title,
      level: e.level,
      team: e.team,
      email: e.email,
      location: e.location,
      managerId: e.managerId,
      startDate: monthsAgoDate(e.startedMonthsAgo),
      status: e.status,
      baseSalary: e.baseSalary,
      lastRaiseDate:
        e.lastRaiseMonthsAgo === null
          ? null
          : monthsAgoDate(e.lastRaiseMonthsAgo),
      buddyId: e.buddyId,
      notes: [],
    })),
    requests: SEED_REQUESTS.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      kind: r.kind,
      summary: r.summary,
      detail: r.detail,
      submittedAt: daysAgoIso(r.submittedDaysAgo),
      status: r.status,
      ...(r.days === undefined ? {} : { days: r.days }),
      ...(r.amount === undefined ? {} : { amount: r.amount }),
    })),
    compRequests: SEED_COMP_REQUESTS.map((c) => ({
      id: c.id,
      employeeId: c.employeeId,
      reason: c.reason,
      currentSalary: c.currentSalary,
      requestedSalary: c.requestedSalary,
      proposedLevel: c.proposedLevel,
      submittedBy: c.submittedBy,
      submittedAt: daysAgoIso(c.submittedDaysAgo),
      status: c.status,
      bandExceptionId: null,
    })),
    bandExceptions: [],
    onboardingTasks: SEED_ONBOARDING_TASKS.map((t) => ({ ...t })),
    packets: SEED_PACKETS.map((p) => ({
      id: p.id,
      employeeId: p.employeeId,
      employeeName: p.employeeName,
      role: p.role,
      startDate: monthsAgoDate(p.startedMonthsAgo),
      summary: p.summary,
      highlights: [...p.highlights],
      schedule: p.schedule.map((s) => ({ ...s })),
      filedAt: daysAgoIso(p.filedDaysAgo),
      filedBy: p.filedBy,
    })),
    operators: SEED_OPERATORS.map((o) => ({ ...o })),
  };
}

let state: PeopleStoreState = materialize();

/** Monotonic suffix so generated ids are readable and stable within a run. */
let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}`;
}

export function reset(): void {
  state = materialize();
  counter = 0;
}

// ── Reads ───────────────────────────────────────────────────────────────────

export const employees = (): Employee[] => state.employees;
export const bands = (): Band[] => state.bands;
export const requests = (): PeopleRequest[] => state.requests;
export const compRequests = (): CompRequest[] => state.compRequests;
export const bandExceptions = (): BandException[] => state.bandExceptions;
export const onboardingTasks = (): OnboardingTask[] => state.onboardingTasks;
export const packets = (): OnboardingPacket[] => state.packets;
export const operators = (): Operator[] => state.operators;

export function employee(id: string): Employee | undefined {
  return state.employees.find((e) => e.id === id);
}

export function bandFor(level: Level): Band {
  const found = state.bands.find((b) => b.level === level);
  // Every employee and comp request carries a Level from the union, and the
  // seed defines a band for all five, so this is unreachable — but throwing a
  // coded error beats returning a zeroed band that would silently make every
  // salary look "in band".
  if (!found) throw new Error("UNKNOWN_LEVEL");
  return found;
}

// ── Derived ─────────────────────────────────────────────────────────────────

/**
 * Where a salary sits in a band. `ratio` is clamped to [0, 1] because it drives
 * the ladder's dot position; `outOfBand` is computed from the RAW comparison,
 * so clamping never hides a violation. Keeping those two separate is what lets
 * an out-of-band person render pinned to the rail's edge AND flagged.
 */
export function bandPosition(salary: number, level: Level): BandPosition {
  const band = bandFor(level);
  const span = band.max - band.min;
  const raw = span === 0 ? 0.5 : (salary - band.min) / span;
  return {
    level,
    min: band.min,
    mid: band.mid,
    max: band.max,
    ratio: Math.min(1, Math.max(0, raw)),
    outOfBand: salary < band.min || salary > band.max,
    side: salary < band.min ? "below" : salary > band.max ? "above" : null,
  };
}

export function isWithinBand(salary: number, level: Level): boolean {
  const band = bandFor(level);
  return salary >= band.min && salary <= band.max;
}

/**
 * BEAT 6, the discriminating half. An exception only counts when it is filed
 * against THIS request, has been finalized to `approved`, AND carries a
 * justifying code. A decoy code satisfies the first two and fails the third —
 * which is exactly why "the agent filed an exception" is not the same as "the
 * agent cleared the gate".
 */
export function hasApprovedJustifyingException(compRequestId: string): boolean {
  return state.bandExceptions.some(
    (x) =>
      x.compRequestId === compRequestId &&
      x.status === "approved" &&
      isJustifying(x.code),
  );
}

export function exceptionsFor(compRequestId: string): BandException[] {
  return state.bandExceptions.filter((x) => x.compRequestId === compRequestId);
}

/** The gate, as a pure predicate. `null` = allowed; a string = the refusal code. */
export function compApprovalBlocker(request: CompRequest): string | null {
  if (request.status !== "pending") return "ALREADY_DECIDED";
  if (isWithinBand(request.requestedSalary, request.proposedLevel)) return null;
  if (hasApprovedJustifyingException(request.id)) return null;
  return "OUT_OF_BAND";
}

// ── Mutations ───────────────────────────────────────────────────────────────

/**
 * BEAT 3a. The figure arrives here straight from the chat card the user typed
 * it into; it is never in a prompt, a tool argument the model authored, or a
 * transcript. The caller gets back the employee record WITHOUT the new salary
 * echoed into any agent-visible string — see the route.
 */
export function setBaseSalary(employeeId: string, salary: number): Employee {
  const target = employee(employeeId);
  if (!target) throw new Error("NOT_FOUND");
  if (!Number.isFinite(salary) || salary <= 0)
    throw new Error("INVALID_SALARY");
  if (!isWithinBand(salary, target.level)) throw new Error("OUT_OF_BAND");
  target.baseSalary = Math.round(salary);
  target.lastRaiseDate = new Date().toISOString().slice(0, 10);
  return target;
}

export function decideRequest(
  id: string,
  status: RequestStatus,
): PeopleRequest {
  const target = state.requests.find((r) => r.id === id);
  if (!target) throw new Error("NOT_FOUND");
  target.status = status;
  return target;
}

/** BEAT 5, step 3. The 🎉 prefix is forced by the tool, not by this layer. */
export function addNote(
  employeeId: string,
  text: string,
  author: string,
): Employee {
  const target = employee(employeeId);
  if (!target) throw new Error("NOT_FOUND");
  target.notes.unshift({
    id: nextId("note"),
    text,
    author,
    createdAt: new Date().toISOString(),
  });
  return target;
}

/** BEAT 5, step 2. */
export function assignBuddy(employeeId: string, buddyId: string): Employee {
  const target = employee(employeeId);
  if (!target) throw new Error("NOT_FOUND");
  if (!employee(buddyId)) throw new Error("BUDDY_NOT_FOUND");
  if (buddyId === employeeId) throw new Error("SELF_BUDDY");
  target.buddyId = buddyId;
  return target;
}

/**
 * BEAT 5, step 1. Idempotent by design: re-running the stored procedure on
 * someone who already has a checklist replaces it rather than doubling it, so a
 * presenter who fires the pill twice does not end up with sixteen tasks on
 * stage.
 */
export function createOnboardingTasks(
  employeeId: string,
  labels: { label: string; owner: string; dueOffsetDays: number }[],
): OnboardingTask[] {
  const target = employee(employeeId);
  if (!target) throw new Error("NOT_FOUND");
  state.onboardingTasks = state.onboardingTasks.filter(
    (t) => t.employeeId !== employeeId,
  );
  const created = labels.map((l) => ({
    id: nextId("task"),
    employeeId,
    label: l.label,
    owner: l.owner,
    dueOffsetDays: l.dueOffsetDays,
    done: false,
  }));
  state.onboardingTasks.push(...created);
  return created;
}

export function setTaskDone(id: string, done: boolean): OnboardingTask {
  const target = state.onboardingTasks.find((t) => t.id === id);
  if (!target) throw new Error("NOT_FOUND");
  target.done = done;
  return target;
}

/** BEAT 3d. The durable artifact. */
export function filePacket(input: {
  employeeId: string;
  summary: string;
  highlights: string[];
  schedule: { day: string; item: string }[];
  filedBy: string;
}): OnboardingPacket {
  const target = employee(input.employeeId);
  if (!target) throw new Error("NOT_FOUND");
  const packet: OnboardingPacket = {
    id: nextId("pkt"),
    employeeId: target.id,
    employeeName: target.name,
    role: `${target.title}, ${target.level} · ${target.team}`,
    startDate: target.startDate,
    summary: input.summary,
    highlights: input.highlights.slice(0, 3),
    schedule: input.schedule.slice(0, 8),
    filedAt: new Date().toISOString(),
    filedBy: input.filedBy,
  };
  state.packets.unshift(packet);
  return packet;
}

// ── BEAT 6: the unlock ──────────────────────────────────────────────────────

export function openBandException(
  compRequestId: string,
  code: string,
  justification: string,
): BandException {
  const request = state.compRequests.find((c) => c.id === compRequestId);
  if (!request) throw new Error("NOT_FOUND");
  // Rejected WITHOUT enumerating the catalogue — listing the valid codes here
  // would hand the agent the recipe in one round-trip and beat 6 would stop
  // proving that it learned anything.
  if (!isValidExceptionCode(code)) throw new Error("INVALID_EXCEPTION_CODE");
  const exception: BandException = {
    id: nextId("bex"),
    compRequestId,
    code,
    justification,
    status: "draft",
    openedAt: new Date().toISOString(),
    finalizedAt: null,
  };
  state.bandExceptions.push(exception);
  return exception;
}

export function finalizeBandException(id: string): BandException {
  const exception = state.bandExceptions.find((x) => x.id === id);
  if (!exception) throw new Error("NOT_FOUND");
  if (exception.status === "approved") throw new Error("ALREADY_FINALIZED");
  exception.status = "approved";
  exception.finalizedAt = new Date().toISOString();
  // Link it for display. Note this happens for DECOY codes too — the exception
  // is genuinely on file either way; only `hasApprovedJustifyingException`
  // decides whether it lifts the gate.
  const request = state.compRequests.find(
    (c) => c.id === exception.compRequestId,
  );
  if (request) request.bandExceptionId = exception.id;
  return exception;
}

/**
 * BEAT 6, the gate itself. Throws `OUT_OF_BAND` — a SYMPTOM-ONLY code. Neither
 * this nor the route's message may ever mention band exceptions; naming the fix
 * in the error is the single easiest way to destroy this beat.
 */
export function approveCompRequest(id: string): {
  request: CompRequest;
  employee: Employee;
} {
  const request = state.compRequests.find((c) => c.id === id);
  if (!request) throw new Error("NOT_FOUND");
  const blocker = compApprovalBlocker(request);
  if (blocker) throw new Error(blocker);

  const target = employee(request.employeeId);
  if (!target) throw new Error("NOT_FOUND");
  request.status = "approved";
  target.baseSalary = request.requestedSalary;
  target.level = request.proposedLevel;
  target.lastRaiseDate = new Date().toISOString().slice(0, 10);
  return { request, employee: target };
}

export function declineCompRequest(id: string): CompRequest {
  const request = state.compRequests.find((c) => c.id === id);
  if (!request) throw new Error("NOT_FOUND");
  if (request.status !== "pending") throw new Error("ALREADY_DECIDED");
  request.status = "declined";
  return request;
}

/** The whole ledger, for the client's single-fetch hook. */
export function snapshot(): PeopleStoreState {
  return state;
}

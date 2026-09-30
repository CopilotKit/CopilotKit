/**
 * Myelin's server-side ledger. SERVER-ONLY in practice (no React), and the ONE
 * place state lives: every `/api/myelin/v1/*` route reads and writes through
 * here, the browser reads it back through `GET /ledger`, and the ADK agent in
 * `agent-myelin/` reads and writes it over the same HTTP routes. That shared
 * store is what makes the collaboration beat true: two admins in two windows
 * and the agent are all editing ONE journey, not three copies of it.
 *
 * State hangs off `globalThis` so a dev-server hot reload of one route module
 * does not fork a second, empty store behind the others' backs.
 *
 * Refusable mutations throw an Error whose `message` is a stable CODE; the
 * routes map codes to statuses in `http.ts`. Nothing parses prose.
 */

import {
  DEFAULT_ADMIN_ID,
  SEED_ADMINS,
  SEED_GROUPS,
  SEED_JOURNEYS,
  SEED_LEARNERS,
  ONBOARDING_POLICY,
} from "./seed";
import { ITEM_KINDS } from "./types";
import type {
  Activity,
  AudienceConflict,
  ItemKind,
  Journey,
  JourneyItem,
  MyelinState,
  Presence,
} from "./types";

export { DEFAULT_ADMIN_ID, ONBOARDING_POLICY };

/** Presence entries older than this are treated as gone. */
export const PRESENCE_TTL_MS = 12_000;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function materialize(): MyelinState {
  return {
    journeys: clone(SEED_JOURNEYS),
    groups: clone(SEED_GROUPS),
    learners: clone(SEED_LEARNERS),
    admins: clone(SEED_ADMINS),
    presence: [],
    activity: [],
    notifications: [],
    reminders: [],
    version: 1,
  };
}

interface Holder {
  state: MyelinState;
  counter: number;
}
const g = globalThis as unknown as { __myelinStore?: Holder };
const holder: Holder = (g.__myelinStore ??= {
  state: materialize(),
  counter: 0,
});

function nextId(prefix: string): string {
  holder.counter += 1;
  return `${prefix}-${Date.now().toString(36)}${holder.counter.toString(36)}`;
}

function now(): string {
  return new Date().toISOString();
}

function touch(): void {
  holder.state.version += 1;
}

function log(actor: string, journeyId: string | null, text: string): void {
  const entry: Activity = {
    id: nextId("act"),
    at: now(),
    actor,
    journeyId,
    text,
  };
  holder.state.activity = [entry, ...holder.state.activity].slice(0, 80);
}

export function reset(): void {
  holder.state = materialize();
  holder.counter = 0;
}

// ── Reads ───────────────────────────────────────────────────────────────────

export function snapshot(): MyelinState {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  holder.state.presence = holder.state.presence.filter(
    (p) => p.lastSeen >= cutoff,
  );
  return holder.state;
}

export function journey(id: string): Journey {
  const found = holder.state.journeys.find((j) => j.id === id);
  if (!found) throw new Error("NOT_FOUND");
  return found;
}

function actorName(actor: string): string {
  if (actor === "agent") return "Myelin agent";
  return holder.state.admins.find((a) => a.id === actor)?.name ?? actor;
}

// ── Journey writes ──────────────────────────────────────────────────────────

function assertEditable(j: Journey): void {
  if (j.status === "published") throw new Error("JOURNEY_PUBLISHED");
}

function assertKind(kind: string): asserts kind is ItemKind {
  if (!(ITEM_KINDS as readonly string[]).includes(kind))
    throw new Error("INVALID_KIND");
}

function assertGroups(groupIds: string[]): void {
  for (const id of groupIds) {
    if (!holder.state.groups.some((grp) => grp.id === id))
      throw new Error("UNKNOWN_GROUP");
  }
}

export function createJourney(
  input: { name: string; description?: string; audienceGroupIds?: string[] },
  actor: string,
): Journey {
  const name = input.name?.trim();
  if (!name) throw new Error("INVALID_INPUT");
  const audience = input.audienceGroupIds ?? [];
  assertGroups(audience);
  const j: Journey = {
    id: nextId("j"),
    name,
    description: input.description?.trim() ?? "",
    status: "draft",
    audienceGroupIds: audience,
    items: [],
    audienceRules: [],
    enrollmentWindowDays: null,
    publishedAt: null,
    updatedBy: actor,
    updatedAt: now(),
  };
  holder.state.journeys = [...holder.state.journeys, j];
  log(actor, j.id, `${actorName(actor)} created the journey “${name}”`);
  touch();
  return j;
}

export function updateJourney(
  id: string,
  patch: { name?: string; description?: string; audienceGroupIds?: string[] },
  actor: string,
): Journey {
  const j = journey(id);
  assertEditable(j);
  if (patch.audienceGroupIds) assertGroups(patch.audienceGroupIds);
  if (patch.name !== undefined) j.name = patch.name.trim() || j.name;
  if (patch.description !== undefined) j.description = patch.description.trim();
  if (patch.audienceGroupIds) {
    j.audienceGroupIds = [...new Set(patch.audienceGroupIds)];
    const names = j.audienceGroupIds
      .map((gid) => holder.state.groups.find((grp) => grp.id === gid)?.name)
      .join(", ");
    log(
      actor,
      j.id,
      `${actorName(actor)} set the audience to ${names || "nobody"}`,
    );
  }
  j.updatedBy = actor;
  j.updatedAt = now();
  touch();
  return j;
}

function wouldCycle(
  items: JourneyItem[],
  itemId: string,
  dependsOn: string[],
): boolean {
  const byId = new Map(items.map((i) => [i.id, i]));
  const stack = [...dependsOn];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === itemId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(byId.get(cur)?.dependsOn ?? []));
  }
  return false;
}

export interface ItemInput {
  title: string;
  kind: string;
  minutes: number;
  dependsOn?: string[];
  delayDays?: number;
  required?: boolean;
}

export function addItem(
  journeyId: string,
  input: ItemInput,
  actor: string,
): JourneyItem {
  const j = journey(journeyId);
  assertEditable(j);
  assertKind(input.kind);
  const title = input.title?.trim();
  if (!title) throw new Error("INVALID_INPUT");
  const dependsOn = [...new Set(input.dependsOn ?? [])];
  for (const dep of dependsOn) {
    if (!j.items.some((i) => i.id === dep)) throw new Error("UNKNOWN_ITEM");
  }
  const created: JourneyItem = {
    id: nextId("it"),
    title,
    kind: input.kind,
    minutes: Math.max(1, Math.round(Number(input.minutes) || 5)),
    dependsOn,
    delayDays: Math.max(0, Math.round(Number(input.delayDays) || 0)),
    required: input.required ?? true,
    updatedBy: actor,
    updatedAt: now(),
  };
  j.items = [...j.items, created];
  j.updatedBy = actor;
  j.updatedAt = now();
  log(actor, j.id, `${actorName(actor)} added “${title}”`);
  touch();
  return created;
}

export function updateItem(
  journeyId: string,
  itemId: string,
  patch: Partial<ItemInput>,
  actor: string,
): JourneyItem {
  const j = journey(journeyId);
  assertEditable(j);
  const it = j.items.find((i) => i.id === itemId);
  if (!it) throw new Error("UNKNOWN_ITEM");
  if (patch.kind !== undefined) {
    assertKind(patch.kind);
    it.kind = patch.kind;
  }
  if (patch.title !== undefined && patch.title.trim())
    it.title = patch.title.trim();
  if (patch.minutes !== undefined)
    it.minutes = Math.max(1, Math.round(Number(patch.minutes) || it.minutes));
  if (patch.delayDays !== undefined)
    it.delayDays = Math.max(0, Math.round(Number(patch.delayDays) || 0));
  if (patch.required !== undefined) it.required = Boolean(patch.required);
  if (patch.dependsOn !== undefined) {
    const deps = [...new Set(patch.dependsOn)].filter((d) => d !== itemId);
    for (const dep of deps) {
      if (!j.items.some((i) => i.id === dep)) throw new Error("UNKNOWN_ITEM");
    }
    if (wouldCycle(j.items, itemId, deps)) throw new Error("DEPENDENCY_CYCLE");
    it.dependsOn = deps;
  }
  it.updatedBy = actor;
  it.updatedAt = now();
  j.updatedBy = actor;
  j.updatedAt = now();
  log(actor, j.id, `${actorName(actor)} edited “${it.title}”`);
  touch();
  return it;
}

export function removeItem(
  journeyId: string,
  itemId: string,
  actor: string,
): void {
  const j = journey(journeyId);
  assertEditable(j);
  const it = j.items.find((i) => i.id === itemId);
  if (!it) throw new Error("UNKNOWN_ITEM");
  // Re-wire dependents onto the removed item's own prerequisites, so removing a
  // middle step never silently unlocks everything after it.
  j.items = j.items
    .filter((i) => i.id !== itemId)
    .map((i) =>
      i.dependsOn.includes(itemId)
        ? {
            ...i,
            dependsOn: [
              ...new Set([
                ...i.dependsOn.filter((d) => d !== itemId),
                ...it.dependsOn,
              ]),
            ],
          }
        : i,
    );
  j.updatedBy = actor;
  j.updatedAt = now();
  log(actor, j.id, `${actorName(actor)} removed “${it.title}”`);
  touch();
}

// ── Governance: the pre-publish audience check ─────────────────────────────

export function totalMinutes(j: Journey): number {
  return j.items.reduce((sum, i) => sum + i.minutes, 0);
}

/** Onboarding journeys are paced over two weeks. */
function weeklyMinutes(j: Journey): number {
  return Math.ceil(totalMinutes(j) / 2);
}

/**
 * Who in this journey's audience is already mid-way through another published
 * journey. Counts and ids only — callers that face the agent must not add
 * names (see `conflictSummaryForAgent`).
 */
export function audienceConflicts(journeyId: string): AudienceConflict[] {
  const j = journey(journeyId);
  const audience = new Set(j.audienceGroupIds);
  const conflicts: AudienceConflict[] = [];
  for (const other of holder.state.journeys) {
    if (other.id === j.id || other.status !== "published") continue;
    const learnerIds = holder.state.learners
      .filter((l) => l.groupIds.some((gid) => audience.has(gid)))
      .filter((l) => {
        const p = l.progress[other.id];
        return p !== undefined && p.status !== "complete";
      })
      .map((l) => l.id);
    if (learnerIds.length === 0) continue;
    const groupIds = [
      ...new Set(
        holder.state.learners
          .filter((l) => learnerIds.includes(l.id))
          .flatMap((l) => l.groupIds)
          .filter((gid) => audience.has(gid)),
      ),
    ];
    conflicts.push({
      code: "AUDIENCE_OVERLAP",
      otherJourneyId: other.id,
      otherJourneyName: other.name,
      groupIds,
      learnerIds,
      weeklyMinutesIfConcurrent: weeklyMinutes(j) + weeklyMinutes(other),
      policy: ONBOARDING_POLICY,
    });
  }
  return conflicts;
}

/** The part of the audience check that is cleared by an applied rule. */
export function unresolvedConflicts(journeyId: string): AudienceConflict[] {
  const j = journey(journeyId);
  if (j.audienceRules.some((r) => r.rule === "stagger")) return [];
  return audienceConflicts(journeyId);
}

export function audienceSize(j: Journey): number {
  return j.audienceGroupIds.reduce(
    (sum, gid) =>
      sum +
      (holder.state.groups.find((grp) => grp.id === gid)?.learnerCount ?? 0),
    0,
  );
}

/**
 * Apply an audience rule. The vocabulary is DELIBERATELY a free string checked
 * here and nowhere else: the rule that clears a conflict is something the agent
 * has to be taught by watching an admin, so it must not appear in any schema,
 * tool description, readable or refusal the agent can see. Each wrong guess is
 * refused with a reason a human would recognise.
 */
export function applyAudienceRule(
  journeyId: string,
  rule: string,
  actor: string,
): Journey {
  const j = journey(journeyId);
  assertEditable(j);
  const normalized = rule.trim().toLowerCase();
  if (normalized === "exclude") throw new Error("RULE_EXCLUDE_BLOCKED");
  if (normalized === "override-cap") throw new Error("RULE_CAP_LOCKED");
  if (normalized !== "stagger") throw new Error("UNKNOWN_RULE");
  if (!j.audienceRules.some((r) => r.rule === "stagger")) {
    j.audienceRules = [
      ...j.audienceRules,
      {
        id: nextId("rule"),
        rule: "stagger",
        appliedBy: actor,
        appliedAt: now(),
      },
    ];
  }
  log(
    actor,
    j.id,
    `${actorName(actor)} staggered overlapping learners to start after their current journey`,
  );
  j.updatedBy = actor;
  j.updatedAt = now();
  touch();
  return j;
}

export function publish(journeyId: string, actor: string): Journey {
  const j = journey(journeyId);
  if (j.status === "published") throw new Error("JOURNEY_PUBLISHED");
  if (j.items.length === 0) throw new Error("JOURNEY_EMPTY");
  if (j.audienceGroupIds.length === 0) throw new Error("NO_AUDIENCE");
  if (unresolvedConflicts(journeyId).length > 0)
    throw new Error("AUDIENCE_OVERLAP");
  j.status = "published";
  j.publishedAt = now();
  j.updatedBy = actor;
  j.updatedAt = now();
  log(
    actor,
    j.id,
    `${actorName(actor)} published “${j.name}” to ${audienceSize(j)} learners`,
  );
  touch();
  return j;
}

// ── Launch follow-through (the stored-procedure beat) ───────────────────────

export function setEnrollmentWindow(
  journeyId: string,
  days: number,
  actor: string,
): Journey {
  const j = journey(journeyId);
  const d = Math.round(Number(days));
  if (!Number.isFinite(d) || d < 1 || d > 90) throw new Error("INVALID_INPUT");
  j.enrollmentWindowDays = d;
  log(actor, j.id, `${actorName(actor)} set a ${d}-day enrollment window`);
  j.updatedAt = now();
  touch();
  return j;
}

export function notifyManagers(
  journeyId: string,
  message: string,
  actor: string,
) {
  const j = journey(journeyId);
  const text = message?.trim();
  if (!text) throw new Error("INVALID_INPUT");
  const stores = [
    ...new Set(
      j.audienceGroupIds
        .map((gid) => holder.state.groups.find((grp) => grp.id === gid)?.store)
        .filter(Boolean),
    ),
  ];
  const note = {
    id: nextId("ntf"),
    journeyId,
    audience: `Store managers · ${stores.join(", ") || "all stores"}`,
    message: text,
    sentAt: now(),
  };
  holder.state.notifications = [note, ...holder.state.notifications];
  log(actor, j.id, `${actorName(actor)} notified ${note.audience}`);
  touch();
  return note;
}

export function scheduleReminder(
  journeyId: string,
  afterDays: number,
  message: string,
  actor: string,
) {
  const j = journey(journeyId);
  const d = Math.round(Number(afterDays));
  if (!Number.isFinite(d) || d < 1 || d > 60 || !message?.trim())
    throw new Error("INVALID_INPUT");
  const reminder = {
    id: nextId("rem"),
    journeyId,
    afterDays: d,
    message: message.trim(),
    createdAt: now(),
  };
  holder.state.reminders = [reminder, ...holder.state.reminders];
  log(
    actor,
    j.id,
    `${actorName(actor)} scheduled a day-${d} nudge for learners who have not started`,
  );
  touch();
  return reminder;
}

// ── Presence ────────────────────────────────────────────────────────────────

export function heartbeat(p: Omit<Presence, "lastSeen">): void {
  if (!holder.state.admins.some((a) => a.id === p.adminId))
    throw new Error("UNKNOWN_ADMIN");
  const rest = holder.state.presence.filter((x) => x.adminId !== p.adminId);
  holder.state.presence = [...rest, { ...p, lastSeen: Date.now() }];
  // Presence deliberately does NOT bump `version`: it changes every few seconds
  // and would defeat the pollers' "nothing changed" short-circuit.
}

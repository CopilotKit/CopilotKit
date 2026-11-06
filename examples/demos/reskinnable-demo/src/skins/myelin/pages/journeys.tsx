"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAgentContext } from "@copilotkit/react-core/v2";
import {
  AlertTriangle,
  CheckCircle2,
  Plus,
  Rocket,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref, useSkinSegments } from "@/shell/skin-path";
import { useRecording } from "@/shell/teach";
import { cn } from "@/lib/utils";
import { useMyelinLedger, useMyelinWrite } from "../data/ledger-context";
import {
  KIND_LABEL,
  actorLabel,
  audienceSize,
  calendarDays,
  groupNames,
  relativeTime,
  totalMinutes,
} from "../data/derive";
import { ITEM_KINDS } from "../data/types";
import { RULE_OPTIONS } from "../data/audience-rules";
import type {
  AudienceConflict,
  ItemKind,
  Journey,
  JourneyItem,
  MyelinState,
} from "../data/types";
import { JourneyGraph } from "../components/journey-graph";
import { Avatar, Card, Pill, Stat, useNow } from "../components/primitives";

/** Default journey for the index route: the most recently touched draft. */
export function defaultJourney(state: MyelinState): Journey | undefined {
  const drafts = state.journeys.filter((j) => j.status === "draft");
  const pool = drafts.length ? drafts : state.journeys;
  return [...pool].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function JourneysPage() {
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const segments = useSkinSegments(skin.id);
  const { data, loaded, admin, setLocation } = useMyelinLedger();
  const now = useNow(1000);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const requestedId = segments[0] === "journey" ? segments[1] : undefined;
  const journey = requestedId
    ? data.journeys.find((j) => j.id === requestedId)
    : defaultJourney(data);

  useEffect(() => {
    setLocation("journeys", journey?.id ?? null);
  }, [journey?.id, setLocation]);

  const others = data.presence
    .filter((p) => p.adminId !== admin.id && p.journeyId === journey?.id)
    .map((p) => data.admins.find((a) => a.id === p.adminId))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));

  // ── BEAT 3b: what is on this screen ──────────────────────────────────────
  useAgentContext({
    description:
      "What the Journeys page is showing right now: the journey open in the builder (its steps in order, " +
      "their prerequisites and gaps), its audience, its publish status, and who else is looking at it.",
    value: journey
      ? JSON.stringify({
          page: "Journeys (builder)",
          openJourney: {
            id: journey.id,
            name: journey.name,
            status: journey.status,
            audience: groupNames(data.groups, journey.audienceGroupIds),
            learnersInAudience: audienceSize(data.groups, journey),
            steps: journey.items.map((i) => ({
              id: i.id,
              title: i.title,
              kind: i.kind,
              minutes: i.minutes,
              prerequisites: i.dependsOn.map(
                (d) => journey.items.find((x) => x.id === d)?.title ?? d,
              ),
              waitDaysAfterPrerequisites: i.delayDays,
              required: i.required,
            })),
            totalMinutes: totalMinutes(journey),
            calendarDays: calendarDays(journey),
          },
          otherAdminsViewingThisJourney: others.map((a) => a.name),
          journeysInSidebar: data.journeys.map((j) => ({
            id: j.id,
            name: j.name,
            status: j.status,
          })),
        })
      : JSON.stringify({ page: "Journeys (builder)", openJourney: null }),
  });

  if (!loaded)
    return <p className="text-sm text-ink-muted">Loading journeys…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {data.journeys.map((j) => {
          const viewers = data.presence.filter(
            (p) => p.journeyId === j.id && p.adminId !== admin.id,
          );
          return (
            <Link
              key={j.id}
              href={skinHref(`journey/${j.id}`)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors",
                j.id === journey?.id
                  ? "border-brand/40 bg-brand-soft text-brand"
                  : "border-hairline bg-surface text-ink-muted hover:text-ink",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  j.status === "published" ? "bg-positive" : "bg-brand-violet",
                )}
              />
              {j.name}
              {viewers.length ? (
                <span className="my-presence-dot ml-0.5 h-1.5 w-1.5 rounded-full bg-positive" />
              ) : null}
            </Link>
          );
        })}
      </div>

      <div className="min-w-0 flex-1 space-y-5">
        {!journey ? (
          <Card>
            <p className="text-sm text-ink-muted">
              That journey does not exist.
            </p>
          </Card>
        ) : (
          <>
            <JourneyHeader journey={journey} others={others} now={now} />
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[0.8rem] font-semibold text-ink">
                  Journey map
                </div>
                <div className="flex items-center gap-3 text-[0.68rem] text-ink-muted">
                  <span className="flex items-center gap-1">
                    <svg width="22" height="6" aria-hidden>
                      <path d="M0,3 H22" className="my-edge" />
                    </svg>
                    unlocks next
                  </span>
                  <span className="flex items-center gap-1">
                    <svg width="22" height="6" aria-hidden>
                      <path d="M0,3 H22" className="my-edge my-edge-delay" />
                    </svg>
                    after a gap
                  </span>
                  {journey.status === "draft" ? (
                    <AddStepButton journey={journey} onAdded={setSelectedId} />
                  ) : null}
                </div>
              </div>
              <JourneyGraph
                items={journey.items}
                admins={data.admins}
                now={now}
                selectedId={selectedId}
                onSelect={
                  journey.status === "draft"
                    ? (id) => setSelectedId((cur) => (cur === id ? null : id))
                    : undefined
                }
              />
              {selectedId && journey.status === "draft" ? (
                <StepEditor
                  key={selectedId}
                  journey={journey}
                  item={journey.items.find((i) => i.id === selectedId)}
                  onClose={() => setSelectedId(null)}
                />
              ) : null}
            </Card>
            <div className="grid gap-5 2xl:grid-cols-[1.25fr_1fr]">
              <PublishPanel journey={journey} />
              <ActivityFeed journeyId={journey.id} now={now} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function JourneyHeader({
  journey,
  others,
  now,
}: {
  journey: Journey;
  others: MyelinState["admins"];
  now: number;
}) {
  const { data } = useMyelinLedger();
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight text-ink">
              {journey.name}
            </h1>
            {journey.status === "published" ? (
              <Pill tone="positive">
                <CheckCircle2 className="h-3 w-3" /> Published
              </Pill>
            ) : (
              <Pill tone="accent">Draft</Pill>
            )}
          </div>
          {journey.description ? (
            <p className="mt-1 max-w-2xl text-sm text-ink-muted">
              {journey.description}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-ink-muted" />
            {journey.audienceGroupIds.length ? (
              groupNames(data.groups, journey.audienceGroupIds).map((name) => (
                <Pill key={name} tone="brand">
                  {name}
                </Pill>
              ))
            ) : (
              <span className="text-[0.72rem] text-ink-muted">
                No audience assigned yet
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {others.length ? (
            <div className="flex items-center gap-2 rounded-full border border-hairline bg-surface-muted py-1 pl-1 pr-3">
              <div className="flex -space-x-2">
                {others.map((a) => (
                  <Avatar key={a.id} admin={a} size="sm" ring />
                ))}
              </div>
              <span className="text-[0.7rem] text-ink-muted">
                {others.map((a) => a.name.split(" ")[0]).join(", ")}{" "}
                {others.length === 1 ? "is" : "are"} here
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-hairline pt-4 sm:grid-cols-5">
        <Stat label="Steps" value={journey.items.length} />
        <Stat label="Seat time" value={`${totalMinutes(journey)} min`} />
        <Stat label="Calendar" value={`${calendarDays(journey)} days`} />
        <Stat
          label="Learners"
          value={audienceSize(data.groups, journey).toLocaleString()}
        />
        <Stat
          label="Last edit"
          value={
            <span className="text-sm">
              {actorLabel(data, journey.updatedBy).replace(" agent", "")} ·{" "}
              {relativeTime(journey.updatedAt, now)}
            </span>
          }
        />
      </div>
    </Card>
  );
}

function AddStepButton({
  journey,
  onAdded,
}: {
  journey: Journey;
  onAdded: (id: string) => void;
}) {
  const write = useMyelinWrite();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const last = journey.items[journey.items.length - 1];
        const res = await write(`/journeys/${journey.id}/items`, {
          body: {
            title: "New step",
            kind: "microlesson",
            minutes: 5,
            dependsOn: last ? [last.id] : [],
          },
        });
        setBusy(false);
        if (res.ok && typeof res.body.id === "string") onAdded(res.body.id);
      }}
      className="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface px-2 py-1 text-[0.72rem] font-medium text-ink hover:border-brand/50"
    >
      <Plus className="h-3.5 w-3.5" /> Add step
    </button>
  );
}

function StepEditor({
  journey,
  item,
  onClose,
}: {
  journey: Journey;
  item: JourneyItem | undefined;
  onClose: () => void;
}) {
  const write = useMyelinWrite();
  const [title, setTitle] = useState(item?.title ?? "");
  const [error, setError] = useState<string | null>(null);
  if (!item) return null;

  const save = async (patch: Record<string, unknown>) => {
    const res = await write(`/journeys/${journey.id}/items/${item.id}`, {
      method: "PATCH",
      body: patch,
    });
    setError(
      res.ok ? null : String(res.body.message ?? "That change was refused."),
    );
  };

  return (
    <div className="mt-4 rounded-lg border border-hairline bg-surface-muted p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[220px] flex-1">
          <span className="text-[0.68rem] font-medium text-ink-muted">
            Title
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() =>
              title.trim() && title !== item.title && void save({ title })
            }
            className="mt-1 w-full rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand"
          />
        </label>
        <label>
          <span className="text-[0.68rem] font-medium text-ink-muted">
            Kind
          </span>
          <select
            value={item.kind}
            onChange={(e) => void save({ kind: e.target.value as ItemKind })}
            className="mt-1 block rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm text-ink"
          >
            {ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          key={`m:${item.minutes}`}
          label="Minutes"
          value={item.minutes}
          min={1}
          onCommit={(v) => void save({ minutes: v })}
        />
        <NumberField
          key={`d:${item.delayDays}`}
          label="Gap (days)"
          value={item.delayDays}
          min={0}
          onCommit={(v) => void save({ delayDays: v })}
        />
        <button
          type="button"
          onClick={async () => {
            await write(`/journeys/${journey.id}/items/${item.id}`, {
              method: "DELETE",
            });
            onClose();
          }}
          className="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-[0.75rem] text-negative hover:border-negative/50"
        >
          <Trash2 className="h-3.5 w-3.5" /> Remove
        </button>
      </div>
      <div className="mt-3">
        <span className="text-[0.68rem] font-medium text-ink-muted">
          Prerequisites
        </span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {journey.items
            .filter((i) => i.id !== item.id)
            .map((i) => {
              const on = item.dependsOn.includes(i.id);
              return (
                <button
                  type="button"
                  key={i.id}
                  onClick={() =>
                    void save({
                      dependsOn: on
                        ? item.dependsOn.filter((d) => d !== i.id)
                        : [...item.dependsOn, i.id],
                    })
                  }
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[0.7rem]",
                    on
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-hairline bg-surface text-ink-muted hover:text-ink",
                  )}
                >
                  {i.title}
                </button>
              );
            })}
        </div>
      </div>
      {error ? (
        <p className="mt-2 text-[0.72rem] text-negative">{error}</p>
      ) : null}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  return (
    <label>
      <span className="text-[0.68rem] font-medium text-ink-muted">{label}</span>
      <input
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={() => {
          const n = Number(text);
          if (text !== "" && n >= min && n !== value) onCommit(n);
          else setText(String(value));
        }}
        className="my-num mt-1 block w-20 rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-brand"
      />
    </label>
  );
}

// ── Governance: the audience check and publish ─────────────────────────────

interface AudienceCheck {
  audienceSize: number;
  conflicts: AudienceConflict[];
  unresolved: number;
}

// The overlap-resolution options (RULE_OPTIONS) live in ../data/audience-rules,
// shared with the store and withheld from the agent — see that module.

export function useAudienceCheck(
  journey: Journey | undefined,
): AudienceCheck | null {
  const { data } = useMyelinLedger();
  const [check, setCheck] = useState<AudienceCheck | null>(null);
  const key = journey ? `${journey.id}:${data.version}` : "";
  useEffect(() => {
    if (!journey) return;
    let live = true;
    fetch(`/api/myelin/v1/journeys/${journey.id}/audience-check`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (live && body) setCheck(body as AudienceCheck);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return check;
}

function PublishPanel({ journey }: { journey: Journey }) {
  const { data } = useMyelinLedger();
  const write = useMyelinWrite();
  const recording = useRecording();
  const check = useAudienceCheck(journey);
  const [rule, setRule] = useState<string>("");
  const [message, setMessage] = useState<{
    tone: "positive" | "negative";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const staggered = journey.audienceRules.some((r) => r.rule === "stagger");

  const learnerNames = useMemo(() => {
    const ids = new Set(check?.conflicts.flatMap((c) => c.learnerIds) ?? []);
    return data.learners.filter((l) => ids.has(l.id)).map((l) => l.name);
  }, [check, data.learners]);

  const applyRule = async () => {
    if (!rule) return;
    const label = RULE_OPTIONS.find((o) => o.rule === rule)?.label ?? rule;
    setBusy(true);
    const res = await write(`/journeys/${journey.id}/rules`, {
      body: { rule },
    });
    setBusy(false);
    if (res.ok) {
      recording.logStep(
        `Applied the audience rule “${label}” (rule name: ${rule})`,
        rule,
      );
      setMessage({
        tone: "positive",
        text: "Rule applied — the overlap is cleared.",
      });
    } else {
      recording.logStep(
        `Tried “${label}” — refused: ${String(res.body.message ?? "")}`,
      );
      setMessage({
        tone: "negative",
        text: String(res.body.message ?? "Refused."),
      });
    }
  };

  const publish = async () => {
    setBusy(true);
    const res = await write(`/journeys/${journey.id}/publish`, {});
    setBusy(false);
    if (res.ok) {
      recording.logStep(`Published “${journey.name}”`);
      setMessage({ tone: "positive", text: "Published." });
    } else {
      setMessage({
        tone: "negative",
        text: String(res.body.message ?? "Publish refused."),
      });
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-brand" />
        <h2 className="text-sm font-semibold text-ink">
          Audience check &amp; publishing
        </h2>
      </div>

      {journey.status === "published" ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-positive">
          <CheckCircle2 className="h-4 w-4" /> Live for{" "}
          {audienceSize(data.groups, journey).toLocaleString()} learners
          {journey.enrollmentWindowDays
            ? ` · ${journey.enrollmentWindowDays}-day enrollment window`
            : ""}
        </p>
      ) : !check ? (
        <p className="mt-3 text-sm text-ink-muted">Checking the audience…</p>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-[0.8rem] text-ink-muted">
            <span className="my-num font-semibold text-ink">
              {check.audienceSize.toLocaleString()}
            </span>{" "}
            learners in this audience.
          </p>
          {check.conflicts.length === 0 ? (
            <p className="flex items-center gap-1.5 text-[0.8rem] text-positive">
              <CheckCircle2 className="h-4 w-4" /> No learner is already inside
              another active journey.
            </p>
          ) : (
            check.conflicts.map((c) => (
              <div
                key={c.otherJourneyId}
                className={cn(
                  "rounded-lg border p-3",
                  staggered
                    ? "border-positive/30 bg-positive-soft"
                    : "border-negative/30 bg-negative-soft",
                )}
              >
                <div className="flex items-start gap-2">
                  {staggered ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-negative" />
                  )}
                  <div className="text-[0.78rem] text-ink">
                    <strong className="my-num">
                      {c.learnerIds.length} learners
                    </strong>{" "}
                    are mid-way through <strong>{c.otherJourneyName}</strong>.
                    Enrolling them now breaks the one-onboarding-at-a-time
                    policy (
                    <span className="my-num">
                      {c.weeklyMinutesIfConcurrent}
                    </span>{" "}
                    min/week of training at once).
                    {staggered
                      ? " Staggered: they start this one when that one finishes."
                      : ""}
                  </div>
                </div>
              </div>
            ))
          )}
          {learnerNames.length ? (
            <details className="text-[0.72rem] text-ink-muted">
              <summary className="cursor-pointer">
                Who is affected ({learnerNames.length}) — names stay in your
                browser, never sent to the assistant
              </summary>
              <p className="mt-1.5 leading-relaxed">
                {learnerNames.join(", ")}
              </p>
            </details>
          ) : null}
          {check.unresolved > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={rule}
                onChange={(e) => setRule(e.target.value)}
                aria-label="Resolve the overlap"
                className="min-w-0 flex-1 rounded-md border border-hairline bg-surface px-2 py-1.5 text-[0.78rem] text-ink"
              >
                <option value="">Resolve the overlap…</option>
                {RULE_OPTIONS.map((o) => (
                  <option key={o.rule} value={o.rule}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!rule || busy}
                onClick={() => void applyRule()}
                className="rounded-md border border-hairline bg-surface px-3 py-1.5 text-[0.75rem] font-medium text-ink hover:border-brand/50 disabled:opacity-40"
              >
                Apply rule
              </button>
            </div>
          ) : null}
          <button
            type="button"
            disabled={busy || journey.items.length === 0}
            onClick={() => void publish()}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3.5 py-2 text-[0.8rem] font-semibold text-brand-foreground disabled:opacity-40"
          >
            <Rocket className="h-4 w-4" /> Publish journey
          </button>
        </div>
      )}
      {message ? (
        <p
          className={cn(
            "mt-2 text-[0.75rem]",
            message.tone === "positive" ? "text-positive" : "text-negative",
          )}
        >
          {message.text}
        </p>
      ) : null}
    </Card>
  );
}

function ActivityFeed({ journeyId, now }: { journeyId: string; now: number }) {
  const { data } = useMyelinLedger();
  const rows = data.activity
    .filter((a) => a.journeyId === journeyId)
    .slice(0, 8);
  return (
    <Card>
      <h2 className="text-sm font-semibold text-ink">Recent changes</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-[0.78rem] text-ink-muted">
          No changes yet this session.
        </p>
      ) : (
        <ol className="mt-3 space-y-2">
          {rows.map((a) => {
            const who = data.admins.find((x) => x.id === a.actor);
            return (
              <li key={a.id} className="flex items-start gap-2 text-[0.76rem]">
                {who ? (
                  <Avatar admin={who} size="sm" />
                ) : (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                    <Sparkles className="h-3 w-3" />
                  </span>
                )}
                <span className="min-w-0 flex-1 text-ink">{a.text}</span>
                <span className="shrink-0 text-[0.66rem] text-ink-muted">
                  {relativeTime(a.at, now)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

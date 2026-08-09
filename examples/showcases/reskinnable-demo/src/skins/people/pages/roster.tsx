"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { cn } from "@/lib/utils";
import { usePeopleLedger } from "../data/ledger-context";
import {
  bandPosition,
  formatPercent,
  formatSalary,
  isOutOfBand,
  tenureLabel,
} from "../data/derive";
import type { Employee, Team } from "../data/types";
import { Monogram } from "../components/monogram";
import {
  EmptyState,
  Metric,
  Panel,
  PageHeader,
  Pill,
  SectionLabel,
} from "../components/primitives";

const TEAMS: (Team | "All")[] = [
  "All",
  "Engineering",
  "Design",
  "Go-to-Market",
  "Finance",
  "People Ops",
];

/** A thin in-band position track. Reads at a glance; never claims precision. */
function BandTrack({
  ratio,
  outOfBand,
}: {
  ratio: number;
  outOfBand: boolean;
}) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
      <div
        className={cn(
          "h-full rounded-full",
          outOfBand ? "bg-negative" : "bg-brand/60",
        )}
        style={{ width: `${Math.max(3, ratio * 100)}%` }}
      />
    </div>
  );
}

function PersonCard({
  employee,
  bands,
  buddyName,
}: {
  employee: Employee;
  bands: ReturnType<typeof usePeopleLedger>["data"]["bands"];
  buddyName: string | null;
}) {
  const pos = bandPosition(bands, employee.baseSalary, employee.level);
  const latestNote = employee.notes[0];

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4 shadow-soft transition-shadow hover:shadow-lift">
      <div className="flex items-start gap-3">
        <Monogram
          name={employee.name}
          size="lg"
          ring={pos?.outOfBand ? "negative" : null}
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-ink">
            {employee.name}
          </h3>
          <p className="truncate text-[0.75rem] text-ink-muted">
            {employee.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <Pill tone="brand">{employee.level}</Pill>
            <Pill>{employee.team}</Pill>
            {employee.status === "onboarding" ? (
              <Pill tone="gold">Onboarding</Pill>
            ) : null}
            {employee.status === "on-leave" ? <Pill>On leave</Pill> : null}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between text-[0.7rem]">
          <span className="text-ink-muted">Position in band</span>
          <span
            className={cn(
              "rowan-num font-semibold",
              pos?.outOfBand ? "text-negative" : "text-ink",
            )}
          >
            {pos
              ? pos.outOfBand
                ? `${pos.side} band`
                : formatPercent(pos.ratio)
              : "—"}
          </span>
        </div>
        <BandTrack
          ratio={pos?.ratio ?? 0}
          outOfBand={pos?.outOfBand ?? false}
        />
        <div className="rowan-num mt-1 flex items-baseline justify-between text-[0.68rem] text-ink-muted">
          <span>{formatSalary(employee.baseSalary)}</span>
          <span>{tenureLabel(employee.startDate)}</span>
        </div>
      </div>

      {/* BEAT 5's visible affordances land here: the buddy chip and the forced
          🎉 welcome note both appear on the person's card, so a room can see
          the stored procedure actually changed something. */}
      {buddyName ? (
        <div className="flex items-center gap-1.5 text-[0.7rem] text-ink-muted">
          <span>Buddy</span>
          <Monogram name={buddyName} size="xs" />
          <span className="truncate font-medium text-ink">{buddyName}</span>
        </div>
      ) : null}

      {latestNote ? (
        <p className="rounded-md border border-brand/20 bg-brand-soft px-2.5 py-1.5 text-[0.72rem] text-ink">
          {latestNote.text}
        </p>
      ) : null}
    </article>
  );
}

export function RosterPage() {
  const { data } = usePeopleLedger();
  const [team, setTeam] = useState<Team | "All">("All");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.employees.filter((e) => {
      if (team !== "All" && e.team !== team) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.title.toLowerCase().includes(q) ||
        e.level.toLowerCase() === q
      );
    });
  }, [data.employees, team, query]);

  const nameOf = (id: string | null) =>
    id ? (data.employees.find((e) => e.id === id)?.name ?? null) : null;

  const outOfBand = data.employees.filter((e) => isOutOfBand(data.bands, e));
  const openRequests = data.requests.filter((r) => r.status === "pending");
  const startingSoon = data.employees.filter((e) => e.status === "onboarding");

  // ── BEAT 3b: WHAT IS VISIBLY ON SCREEN ───────────────────────────────────
  // Not the whole roster — the rows actually rendered after the team filter and
  // the search box, in the order shown, plus the live filter state. That
  // distinction IS the beat: the agent describing what the user can literally
  // see, and giving a different answer once they filter or navigate.
  useAgentContext({
    description:
      "The Roster page the user is currently viewing: the active team filter " +
      "and search text, and the employee cards actually visible on screen, in " +
      "the order shown.",
    value: JSON.stringify({
      page: "roster",
      filters: { team, search: query || null },
      visibleCount: visible.length,
      totalHeadcount: data.employees.length,
      rows: visible.slice(0, 25).map((e) => ({
        name: e.name,
        title: e.title,
        level: e.level,
        team: e.team,
        status: e.status,
        baseSalary: e.baseSalary,
        positionInBand: (() => {
          const pos = bandPosition(data.bands, e.baseSalary, e.level);
          if (!pos) return null;
          return pos.outOfBand ? `${pos.side} band` : formatPercent(pos.ratio);
        })(),
        tenure: tenureLabel(e.startDate),
        buddy: nameOf(e.buddyId),
      })),
    }),
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Roster"
        subtitle={`${data.employees.length} people across ${new Set(data.employees.map((e) => e.team)).size} teams`}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Headcount" value={String(data.employees.length)} />
        <Metric
          label="Outside their band"
          value={String(outOfBand.length)}
          tone={outOfBand.length ? "negative" : "positive"}
          hint={outOfBand.map((e) => e.name.split(" ")[0]).join(", ") || "None"}
        />
        <Metric label="Open requests" value={String(openRequests.length)} />
        <Metric
          label="Starting soon"
          value={String(startingSoon.length)}
          tone={startingSoon.length ? "gold" : "neutral"}
          hint={
            startingSoon.map((e) => e.name.split(" ")[0]).join(", ") || "None"
          }
        />
      </div>

      <Panel className="mb-4" padded={false}>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, title, or level"
              aria-label="Search the roster"
              className="w-full rounded-md border border-hairline bg-surface py-1.5 pl-8 pr-3 text-[0.8rem] text-ink outline-none placeholder:text-ink-muted focus:border-brand/50"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {TEAMS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => setTeam(candidate)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[0.72rem] transition-colors",
                  team === candidate
                    ? "border-brand/50 bg-brand-soft font-semibold text-brand"
                    : "border-hairline bg-surface text-ink-muted hover:text-ink",
                )}
              >
                {candidate}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      <SectionLabel>
        {visible.length === data.employees.length
          ? "Everyone"
          : `${visible.length} of ${data.employees.length} people`}
      </SectionLabel>

      {visible.length === 0 ? (
        <EmptyState
          title="No one matches that"
          hint="Clear the search box or pick a different team to see the rest of the roster."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((employee) => (
            <PersonCard
              key={employee.id}
              employee={employee}
              bands={data.bands}
              buddyName={nameOf(employee.buddyId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

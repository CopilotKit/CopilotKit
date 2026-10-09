"use client";

import { useMemo, useState } from "react";
import { CalendarDays, FileText, Sprout } from "lucide-react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { cn } from "@/lib/utils";
import { usePeopleLedger } from "../data/ledger-context";
import { daysUntil, tenureLabel } from "../data/derive";
import type { Employee } from "../data/types";
import { Monogram } from "../components/monogram";
import {
  EmptyState,
  Metric,
  PageHeader,
  Panel,
  Pill,
  SectionLabel,
} from "../components/primitives";

/**
 * The Onboarding page carries two beats.
 *
 * BEAT 5 — the stored procedure's three writes all show up here: the checklist
 * it builds, the buddy it assigns, and the 🎉 welcome note it posts. If none of
 * those were visible the procedure would fire correctly and prove nothing.
 *
 * BEAT 3d — the Packets tab is the DURABLE ARTIFACT surface. A packet is stored
 * in the app's ledger, not in the conversation, so the presenter can delete the
 * whole thread and the packet is still sitting right here. That is the entire
 * argument of the beat, and it is why this tab reads from the ledger and has no
 * notion of a thread id.
 */

function ChecklistCard({ employee }: { employee: Employee }) {
  const { data, refresh } = usePeopleLedger();
  const tasks = data.onboardingTasks.filter(
    (t) => t.employeeId === employee.id,
  );
  const done = tasks.filter((t) => t.done).length;
  const buddy = data.employees.find((e) => e.id === employee.buddyId);
  const until = daysUntil(employee.startDate);

  const toggle = async (id: string, next: boolean) => {
    await fetch(`/api/people/v1/onboarding-tasks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ done: next }),
    });
    await refresh();
  };

  return (
    <Panel>
      <div className="flex flex-wrap items-start gap-3">
        <Monogram name={employee.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink">{employee.name}</h3>
          <p className="text-[0.75rem] text-ink-muted">
            {employee.title} · {employee.level} · {employee.team}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Pill tone={until > 0 ? "gold" : "positive"}>
              <CalendarDays className="h-3 w-3" />
              {tenureLabel(employee.startDate)}
            </Pill>
            {buddy ? (
              <Pill tone="brand">Buddy · {buddy.name}</Pill>
            ) : (
              <Pill tone="neutral">No buddy yet</Pill>
            )}
          </div>
        </div>
        <div className="rowan-num text-right">
          <div className="text-lg font-semibold text-ink">
            {done}/{tasks.length || 0}
          </div>
          <div className="text-[0.65rem] text-ink-muted">complete</div>
        </div>
      </div>

      {employee.notes.length > 0 ? (
        <p className="mt-3 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[0.75rem] text-ink">
          {employee.notes[0].text}
        </p>
      ) : null}

      <div className="mt-4">
        {tasks.length === 0 ? (
          <EmptyState
            icon={<Sprout className="h-5 w-5" />}
            title="No checklist yet"
            hint={`Nothing has been set up for ${employee.name.split(" ")[0]} — ask Rowan to handle the start and it will build the checklist, assign a buddy, and post a welcome.`}
          />
        ) : (
          <ul className="space-y-1.5">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-2.5">
                <input
                  id={task.id}
                  type="checkbox"
                  checked={task.done}
                  onChange={(event) =>
                    void toggle(task.id, event.target.checked)
                  }
                  className="h-3.5 w-3.5 shrink-0 accent-[hsl(var(--brand))]"
                />
                <label
                  htmlFor={task.id}
                  className={cn(
                    "min-w-0 flex-1 cursor-pointer truncate text-[0.78rem]",
                    task.done ? "text-ink-muted line-through" : "text-ink",
                  )}
                >
                  {task.label}
                </label>
                <span className="shrink-0 text-[0.68rem] text-ink-muted">
                  {task.owner}
                </span>
                <span className="rowan-num w-12 shrink-0 text-right text-[0.68rem] text-ink-muted">
                  {task.dueOffsetDays >= 0
                    ? `day ${task.dueOffsetDays}`
                    : `${-task.dueOffsetDays}d before`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

export function OnboardingPage() {
  const { data } = usePeopleLedger();
  const [tab, setTab] = useState<"checklists" | "packets">("checklists");

  // Anyone still onboarding, plus anyone who joined in the last ~90 days and
  // still has an open item — a checklist does not stop mattering the moment
  // someone's status flips to active.
  const rampingUp = useMemo(() => {
    const ids = new Set(
      data.onboardingTasks.filter((t) => !t.done).map((t) => t.employeeId),
    );
    return data.employees.filter(
      (e) => e.status === "onboarding" || ids.has(e.id),
    );
  }, [data.employees, data.onboardingTasks]);

  const openTasks = data.onboardingTasks.filter((t) => !t.done).length;

  useAgentContext({
    description:
      "The Onboarding page the user is currently viewing: which tab is open, " +
      "the new hires ramping up with their checklist progress and buddy, and " +
      "the onboarding packets filed in the app.",
    value: JSON.stringify({
      page: "onboarding",
      tab,
      newHires: rampingUp.map((e) => {
        const tasks = data.onboardingTasks.filter((t) => t.employeeId === e.id);
        return {
          id: e.id,
          name: e.name,
          title: e.title,
          team: e.team,
          startDate: e.startDate,
          startsIn: tenureLabel(e.startDate),
          buddy: data.employees.find((b) => b.id === e.buddyId)?.name ?? null,
          checklist: {
            total: tasks.length,
            done: tasks.filter((t) => t.done).length,
          },
          latestNote: e.notes[0]?.text ?? null,
        };
      }),
      packets: data.packets.map((p) => ({
        id: p.id,
        employeeName: p.employeeName,
        role: p.role,
        startDate: p.startDate,
        summary: p.summary,
        highlights: p.highlights,
      })),
    }),
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Onboarding"
        subtitle="Everyone in their first ninety days, and the packets filed for them."
      />

      <div className="mb-5 grid grid-cols-3 gap-3">
        <Metric
          label="Ramping up"
          value={String(rampingUp.length)}
          tone="gold"
        />
        <Metric label="Open checklist items" value={String(openTasks)} />
        <Metric label="Packets on file" value={String(data.packets.length)} />
      </div>

      <div className="mb-4 flex gap-1 border-b border-hairline">
        {(["checklists", "packets"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setTab(candidate)}
            aria-current={tab === candidate ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[0.8rem] font-medium capitalize transition-colors",
              tab === candidate
                ? "border-brand text-brand"
                : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {candidate}
          </button>
        ))}
      </div>

      {tab === "checklists" ? (
        rampingUp.length === 0 ? (
          <EmptyState
            title="Nobody is onboarding right now"
            hint="New hires appear here from their offer acceptance until their checklist is complete."
          />
        ) : (
          <div className="space-y-4">
            {rampingUp.map((employee) => (
              <ChecklistCard key={employee.id} employee={employee} />
            ))}
          </div>
        )
      ) : (
        <>
          <SectionLabel>
            Filed packets — these belong to the app, not to any conversation
          </SectionLabel>
          {data.packets.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-5 w-5" />}
              title="No packets yet"
              hint="Send Rowan an offer letter and ask for a packet; it reads the document and files the result here."
            />
          ) : (
            <div className="space-y-3">
              {data.packets.map((packet) => (
                <Panel key={packet.id}>
                  <div className="flex flex-wrap items-start gap-3">
                    <Monogram name={packet.employeeName} size="md" />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-ink">
                        {packet.employeeName}
                      </h3>
                      <p className="text-[0.72rem] text-ink-muted">
                        {packet.role}
                      </p>
                    </div>
                    <span className="rowan-num shrink-0 text-[0.68rem] text-ink-muted">
                      Filed by {packet.filedBy}
                    </span>
                  </div>

                  <p className="mt-3 text-[0.8rem] leading-relaxed text-ink">
                    {packet.summary}
                  </p>

                  {packet.highlights.length > 0 ? (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {packet.highlights.map((highlight) => (
                        <li key={highlight}>
                          <Pill tone="brand">{highlight}</Pill>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {packet.schedule.length > 0 ? (
                    <ol className="mt-3 space-y-1 border-t border-hairline pt-3">
                      {packet.schedule.map((entry) => (
                        <li
                          key={`${entry.day}-${entry.item}`}
                          className="flex gap-3 text-[0.76rem]"
                        >
                          <span className="w-16 shrink-0 font-semibold text-brand">
                            {entry.day}
                          </span>
                          <span className="text-ink">{entry.item}</span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </Panel>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  useAgentContext,
  useComponent,
  useFrontendTool,
  useHumanInTheLoop,
} from "@copilotkit/react-core/v2";
import { CheckCircle2, CircleAlert, Radio, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSkin } from "@/shell/skin-provider";
import { useSkinHref } from "@/shell/skin-path";
import { usePeopleLedger } from "./data/ledger-context";
import {
  ageInDays,
  bandPosition,
  formatPercent,
  formatSalary,
  isOutOfBand,
  REQUEST_KIND_LABEL,
  requestValueLabel,
  tenureLabel,
} from "./data/derive";
import type { Employee, PeopleStoreState } from "./data/types";
import { BandLadder } from "./components/band-ladder";
import { Monogram } from "./components/monogram";
import { Pill } from "./components/primitives";
import { useRecording } from "@/shell/teach";

/**
 * Every frontend tool, HITL card, gen-UI component and global readable Rowan
 * ships. Renders null. Registered at the SKIN level rather than per page, so
 * the teach-mode chain survives the navigation it is recording.
 *
 * Four rules run through this whole file; each fails SILENTLY if broken.
 *
 *  1. EVERY registration closes with a deps array. Omit it and the closure
 *     captures whatever the data was at registration time — for a REST-backed
 *     skin, the EMPTY ledger from before the first fetch — forever. It
 *     compiles, it lints, it passes tests, and the agent narrates confidently
 *     over a component rendering its "not found" branch.
 *
 *  2. A parameterized `useComponent` render receives the schema output
 *     DIRECTLY (`render: ({ level }) => …`). Only `useFrontendTool` and
 *     `useHumanInTheLoop` renders get `{ args, status, result, respond }`.
 *
 *  3. Renders are REPLAY-SAFE: keyed off `result`, never off `status`. Reopen a
 *     thread and you get the recorded result with no live status transition, so
 *     a status-keyed render is perfect during the demo and blank the moment
 *     anyone revisits — which is exactly when beat 2 is being shown.
 *
 *  4. Nothing sensitive goes into a tool result. Whatever a handler returns is
 *     stored in the thread forever (beat 3a).
 */

/**
 * BEAT 2 + 3a — replay memory for the salary card.
 *
 * On thread reopen a HITL call replays as in-progress with no live state, so
 * the card needs somewhere to recover what happened. This map holds ONLY the
 * person's name and the label shown — never the figure the user typed. That
 * omission is the beat: the number exists in the REST call and the ledger, and
 * nowhere the assistant or the transcript can reach.
 */
const answeredSalaryChanges = new Map<string, { name: string }>();

/** Same idea for the navigate-confirm card. */
const answeredNavigations = new Map<string, { confirmed: boolean }>();

function ToolCard({
  tone = "brand",
  children,
}: {
  tone?: "brand" | "positive" | "negative";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "my-1 rounded-lg border bg-surface p-3 text-ink shadow-soft",
        tone === "brand" && "border-brand/25",
        tone === "positive" && "border-positive/30",
        tone === "negative" && "border-negative/30",
      )}
    >
      {children}
    </div>
  );
}

/** A one-line "this happened" receipt. Every mutation gets one. */
function Receipt({
  tone = "positive",
  icon,
  children,
}: {
  tone?: "positive" | "negative";
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "my-1 flex items-start gap-2 rounded-lg border px-3 py-2 text-[0.8rem]",
        tone === "positive"
          ? "border-positive/30 bg-positive-soft text-ink"
          : "border-negative/30 bg-negative-soft text-ink",
      )}
    >
      <span className={tone === "positive" ? "text-positive" : "text-negative"}>
        {icon ?? <CheckCircle2 className="mt-0.5 h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

export function PeopleTools() {
  const { data, refresh, operator } = usePeopleLedger();
  const router = useRouter();
  const skin = useSkin();
  const skinHref = useSkinHref(skin.id);
  const recording = useRecording();

  /**
   * Handlers read the ledger through a ref, not through the closure.
   *
   * `useFrontendTool` / `useHumanInTheLoop` TEAR DOWN and re-register whenever
   * their deps change. A `[data]` dep on a tool that itself mutates the ledger
   * therefore unregisters the tool in the middle of its own call — the write
   * lands, the tool disappears, and the agent gets no result. Banking hit this
   * exact bug with its PIN tool. So: `[]` deps on write tools plus this ref,
   * and real deps on the read-only display components below.
   */
  const ledgerRef = useRef<PeopleStoreState>(data);
  useEffect(() => {
    ledgerRef.current = data;
  }, [data]);
  const operatorRef = useRef(operator);
  useEffect(() => {
    operatorRef.current = operator;
  }, [operator]);

  const findPerson = (needle: string): Employee | undefined => {
    const rows = ledgerRef.current.employees;
    const key = needle.trim().toLowerCase();
    return (
      rows.find((e) => e.id === needle) ??
      rows.find((e) => e.name.toLowerCase() === key) ??
      rows.find((e) => e.name.toLowerCase().startsWith(key)) ??
      rows.find((e) => e.name.toLowerCase().includes(key))
    );
  };

  // ── Global readables ──────────────────────────────────────────────────────
  // The page-scoped readables (in each page component) say what is ON SCREEN.
  // This one says what EXISTS, so tools callable from anywhere — assign a
  // buddy, approve a comp request — can resolve a name to an id without the
  // user having to be on the right page first.
  useAgentContext({
    description:
      "The Rowan people ledger: everyone employed, the compensation bands, " +
      "each person's position in their band, the open requests, the pending " +
      "compensation requests, and the onboarding packets on file. Use this to " +
      "resolve a person's name to an id before calling any tool.",
    value: JSON.stringify({
      bands: data.bands,
      employees: data.employees.map((e) => {
        const pos = bandPosition(data.bands, e.baseSalary, e.level);
        return {
          id: e.id,
          name: e.name,
          title: e.title,
          level: e.level,
          team: e.team,
          status: e.status,
          startDate: e.startDate,
          tenure: tenureLabel(e.startDate),
          baseSalary: e.baseSalary,
          positionInBand: pos
            ? pos.outOfBand
              ? `${pos.side} band`
              : formatPercent(pos.ratio)
            : null,
          outOfBand: pos?.outOfBand ?? false,
          managerId: e.managerId,
          buddyId: e.buddyId,
        };
      }),
      openRequests: data.requests
        .filter((r) => r.status === "pending")
        .map((r) => ({
          id: r.id,
          employee: data.employees.find((e) => e.id === r.employeeId)?.name,
          kind: REQUEST_KIND_LABEL[r.kind],
          summary: r.summary,
          ageDays: ageInDays(r.submittedAt),
          value: requestValueLabel(r),
        })),
      pendingCompRequests: data.compRequests
        .filter((c) => c.status === "pending")
        .map((c) => ({
          id: c.id,
          employee: data.employees.find((e) => e.id === c.employeeId)?.name,
          reason: c.reason,
          currentSalary: c.currentSalary,
          requestedSalary: c.requestedSalary,
          proposedLevel: c.proposedLevel,
        })),
      packets: data.packets.map((p) => ({
        id: p.id,
        employeeName: p.employeeName,
        role: p.role,
      })),
    }),
  });

  // ══ BEAT 1 — GIVE THE AGENT A FACE ═══════════════════════════════════════
  // Lead with generative UI, never a wall of text. The ladder is Rowan's
  // signature visual and its first answer.

  useComponent(
    {
      name: "showCompBands",
      description:
        "Display the compensation band ladder: every person placed at their " +
        "position inside their own band, with anyone outside their band " +
        "flagged. Use this for any question about bands, band position, who is " +
        "out of band, or how compensation is distributed. Render the ladder " +
        "AND answer in one or two sentences — never one without the other.",
      parameters: z.object({
        level: z
          .string()
          .optional()
          .describe('Restrict to one level, e.g. "L5". Omit for every level.'),
      }),
      // Parameterized `useComponent` → the render receives the schema output
      // DIRECTLY. This is NOT the `{ args }` shape a HITL render gets.
      render: ({ level }) => {
        const people = level
          ? data.employees.filter((e) => e.level === level)
          : data.employees;
        return (
          <ToolCard>
            <BandLadder bands={data.bands} employees={people} compact />
          </ToolCard>
        );
      },
    },
    [data],
  );

  useComponent(
    {
      name: "showPerson",
      description:
        "Display one person's card: level, team, tenure, position in band, " +
        "buddy and latest note. Use when the user asks about a specific person.",
      parameters: z.object({
        employee: z.string().describe("The person's name or id."),
      }),
      render: ({ employee }) => {
        const person =
          data.employees.find((e) => e.id === employee) ??
          data.employees.find(
            (e) => e.name.toLowerCase() === employee.trim().toLowerCase(),
          ) ??
          data.employees.find((e) =>
            e.name.toLowerCase().includes(employee.trim().toLowerCase()),
          );
        if (!person) {
          return (
            <ToolCard tone="negative">
              <p className="text-[0.8rem] text-ink-muted">
                No one on the roster matches “{employee}”.
              </p>
            </ToolCard>
          );
        }
        const pos = bandPosition(data.bands, person.baseSalary, person.level);
        const buddy = data.employees.find((e) => e.id === person.buddyId);
        return (
          <ToolCard>
            <div className="flex items-start gap-3">
              <Monogram
                name={person.name}
                size="lg"
                ring={pos?.outOfBand ? "negative" : "brand"}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{person.name}</p>
                <p className="text-[0.75rem] text-ink-muted">{person.title}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <Pill tone="brand">{person.level}</Pill>
                  <Pill>{person.team}</Pill>
                  <Pill>{tenureLabel(person.startDate)}</Pill>
                  {pos?.outOfBand ? (
                    <Pill tone="negative">{pos.side} band</Pill>
                  ) : (
                    <Pill tone="positive">
                      {pos ? formatPercent(pos.ratio) : "—"} of band
                    </Pill>
                  )}
                  {buddy ? <Pill tone="gold">Buddy · {buddy.name}</Pill> : null}
                </div>
                {person.notes[0] ? (
                  <p className="mt-2 rounded-md bg-brand-soft px-2 py-1 text-[0.72rem]">
                    {person.notes[0].text}
                  </p>
                ) : null}
              </div>
            </div>
          </ToolCard>
        );
      },
    },
    [data],
  );

  useComponent(
    {
      name: "showRequestList",
      description:
        "Display a list of queue requests by id. Use this instead of writing " +
        "a markdown table whenever you are showing more than one request.",
      parameters: z.object({
        requestIds: z
          .array(z.string())
          .describe("Request ids, in the order to show."),
        caption: z.string().optional(),
      }),
      render: ({ requestIds, caption }) => {
        const rows = requestIds
          .map((id) => data.requests.find((r) => r.id === id))
          .filter((r): r is NonNullable<typeof r> => Boolean(r));
        if (rows.length === 0) {
          return (
            <ToolCard tone="negative">
              <p className="text-[0.8rem] text-ink-muted">
                No matching requests.
              </p>
            </ToolCard>
          );
        }
        return (
          <ToolCard>
            {caption ? (
              <p className="mb-2 text-[0.75rem] font-medium text-ink-muted">
                {caption}
              </p>
            ) : null}
            <ul className="divide-y divide-hairline">
              {rows.map((request) => {
                const who =
                  data.employees.find((e) => e.id === request.employeeId)
                    ?.name ?? "Unknown";
                return (
                  <li
                    key={request.id}
                    className="flex items-center gap-2 py-1.5"
                  >
                    <Monogram name={who} size="xs" />
                    <span className="min-w-0 flex-1 truncate text-[0.78rem]">
                      {request.summary}
                    </span>
                    <span className="rowan-num shrink-0 text-[0.7rem] text-ink-muted">
                      {ageInDays(request.submittedAt)}d
                    </span>
                    <span className="rowan-num shrink-0 text-[0.72rem] font-medium">
                      {requestValueLabel(request)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </ToolCard>
        );
      },
    },
    [data],
  );

  // ══ BEAT 4 — LONG-TERM MEMORY ════════════════════════════════════════════
  // `note` is the slot where the agent NAMES the preference it recalled. Without
  // a visible "why", recall looks like a normal answer and the beat is
  // invisible to the room even when it worked perfectly.
  useComponent(
    {
      name: "showCompSummary",
      description:
        "Summarize where compensation stands. Before calling this, recall the " +
        "user's saved formatting preference and pass it through the flags. " +
        "ALWAYS fill `note` with the preference you applied, in your own " +
        "words — that is how the user knows you remembered.",
      parameters: z.object({
        byLevel: z.boolean().describe("Group by level rather than by team."),
        outOfBandFirst: z
          .boolean()
          .describe("Put anyone outside their band at the top."),
        asPercentile: z
          .boolean()
          .describe(
            "Show position in band as a percentage instead of a salary.",
          ),
        note: z
          .string()
          .describe(
            "Name the saved preference you applied, e.g. 'You read these by level, out-of-band first.'",
          ),
      }),
      render: ({ byLevel, outOfBandFirst, asPercentile, note }) => {
        const rows = [...data.employees].sort((a, b) => {
          if (outOfBandFirst) {
            const aOut = isOutOfBand(data.bands, a) ? 0 : 1;
            const bOut = isOutOfBand(data.bands, b) ? 0 : 1;
            if (aOut !== bOut) return aOut - bOut;
          }
          if (byLevel && a.level !== b.level)
            return a.level.localeCompare(b.level);
          return a.name.localeCompare(b.name);
        });

        return (
          <ToolCard>
            {/* The "why" slot. Gold, because in Rowan gold marks a milestone —
                and remembering is one. */}
            <p className="mb-2 flex items-start gap-1.5 rounded-md border border-brand-violet/30 bg-brand-violet/10 px-2.5 py-1.5 text-[0.74rem] text-ink">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-violet" />
              <span>{note}</span>
            </p>
            <ul className="divide-y divide-hairline">
              {rows.slice(0, 12).map((person) => {
                const pos = bandPosition(
                  data.bands,
                  person.baseSalary,
                  person.level,
                );
                return (
                  <li
                    key={person.id}
                    className="flex items-center gap-2 py-1.5"
                  >
                    <Monogram name={person.name} size="xs" />
                    <span className="min-w-0 flex-1 truncate text-[0.78rem]">
                      {person.name}
                    </span>
                    {byLevel ? (
                      <Pill tone="brand">{person.level}</Pill>
                    ) : (
                      <Pill>{person.team}</Pill>
                    )}
                    <span
                      className={cn(
                        "rowan-num w-24 shrink-0 text-right text-[0.74rem] font-medium",
                        pos?.outOfBand && "text-negative",
                      )}
                    >
                      {pos?.outOfBand
                        ? `${pos.side} band`
                        : asPercentile
                          ? `${pos ? formatPercent(pos.ratio) : "—"} of band`
                          : formatSalary(person.baseSalary)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </ToolCard>
        );
      },
    },
    [data],
  );

  // ══ BEAT 3a — DRIVE THE APP, SECRET WITHHELD ═════════════════════════════
  useHumanInTheLoop(
    {
      name: "setBaseSalary",
      description:
        "Open the merit-increase card for one person so the user can enter the " +
        "new base salary themselves. NEVER ask for the figure and never ask " +
        "which person first — call this immediately with your best match.",
      parameters: z.object({
        employee: z.string().describe("The person's name or id."),
      }),
      render: ({ args, respond, result, toolCallId }) => {
        // REPLAY-SAFE. Consult the answered map first (a thread reopened in the
        // same session), then the recorded `result` (a reload). Only fall
        // through to the live editor when neither exists. Nothing here reads
        // `status`, which does not replay.
        //
        // The result must be CLASSIFIED, not merely detected. An earlier version
        // branched on "is there a result at all" and rendered the success
        // receipt for every settled call — so a CANCELLED change replayed as
        // "Base salary updated for that person", claiming a mutation that never
        // happened and printing the fallback name because the success regex had
        // nothing to match. A replayed card asserting a write that did not occur
        // is worse than a blank one, and only shows up when someone reopens the
        // thread — which is exactly when beat 2 is being demonstrated.
        const remembered = toolCallId
          ? answeredSalaryChanges.get(toolCallId)
          : undefined;
        const settled = typeof result === "string" ? result : null;
        const updatedName =
          remembered?.name ??
          (settled
            ? /^Base salary updated for (.+?)\.$/.exec(settled)?.[1]
            : undefined);

        if (updatedName) {
          return (
            <Receipt>
              Base salary updated for <strong>{updatedName}</strong>. The figure
              stayed in this card — it was never sent to the assistant.
            </Receipt>
          );
        }
        if (settled) {
          // Cancelled, or the REST call was refused. Say which, plainly.
          const cancelled = /cancelled/i.test(settled);
          return (
            <Receipt
              tone="negative"
              icon={<CircleAlert className="mt-0.5 h-4 w-4" />}
            >
              {cancelled
                ? "The salary change was cancelled — nothing was updated."
                : settled}
            </Receipt>
          );
        }
        return (
          <SalaryCard
            employeeQuery={args?.employee ?? ""}
            find={findPerson}
            bands={ledgerRef.current.bands}
            onDone={async (person, salary) => {
              const res = await fetch(
                `/api/people/v1/employees/${person.id}/compensation`,
                {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ baseSalary: salary }),
                },
              );
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                respond?.(
                  `Could not update ${person.name}: ${body?.message ?? res.status}`,
                );
                return;
              }
              if (toolCallId) {
                answeredSalaryChanges.set(toolCallId, { name: person.name });
              }
              await refresh();
              // The ONLY thing the assistant ever learns. No figure, by design.
              respond?.(`Base salary updated for ${person.name}.`);
            }}
            onCancel={() => respond?.("The user cancelled the salary change.")}
          />
        );
      },
    },
    // `[]` + ledgerRef: this tool writes, and a data dep would tear it down
    // mid-write. See the note on ledgerRef above.
    [],
  );

  // ══ BEAT 3c — NAVIGATE WITH LEVERS ═══════════════════════════════════════
  useHumanInTheLoop(
    {
      name: "showRequestQueue",
      description:
        "Take the user to the Requests page with a specific status filter, " +
        "sort order and top-N limit applied. Confirm with them first — the " +
        "CARD this opens lists the levers and waits for their click, so calling " +
        "this IS how you confirm. Never describe the levers in chat and ask " +
        "them to confirm in words; that leaves them where they were. Use for " +
        "any 'show me the oldest / biggest / pending requests' question. " +
        "EVERY lever is REQUIRED: set the ones the request implies, and pass " +
        "'all' (or 0 for the limit) for the ones it does not — that is how you " +
        "say 'leave this lever alone', and it is the only way to say it. Never " +
        "omit a lever, and never fill one merely because the schema offers it: " +
        "a lever the user did not ask for narrows the queue for no reason and " +
        "claims a choice they never made.",
      parameters: z.object({
        status: z.enum(["all", "pending", "approved", "declined"]),
        sort: z.enum(["aging_desc", "aging_asc", "amount_desc"]),
        // REQUIRED, with 0 as the "no limit" sentinel rather than `.optional()`.
        // An optional lever invites the model to go and ask for the missing
        // value, which is one more reason to talk instead of act. 0 needs no
        // special handling downstream: the render below sets the `top` query
        // param only `if (args?.top)`, which is falsy at 0, so the page sees no
        // limit and shows every matching row.
        top: z
          .number()
          .int()
          .min(0)
          .describe("Limit to the first N rows. 0 means no limit."),
        reason: z.string().describe("One short line on why this view."),
      }),
      render: ({ args, respond, result, toolCallId }) => {
        const remembered = toolCallId
          ? answeredNavigations.get(toolCallId)
          : undefined;
        const settled = remembered !== undefined || typeof result === "string";
        const confirmed =
          remembered?.confirmed ?? String(result ?? "").startsWith("Opened");

        const levers = [
          `Status · ${args?.status ?? "pending"}`,
          `Sort · ${
            args?.sort === "aging_asc"
              ? "newest first"
              : args?.sort === "amount_desc"
                ? "largest value"
                : "oldest first"
          }`,
          args?.top ? `Show · top ${args.top}` : "Show · all",
        ];

        return (
          <ToolCard tone={settled && !confirmed ? "negative" : "brand"}>
            <p className="text-[0.8rem] font-medium">
              {settled
                ? confirmed
                  ? "Opened the Requests page with these controls set:"
                  : "Stayed on this page."
                : "I can open the Requests page with these controls set:"}
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {levers.map((lever) => (
                <li key={lever}>
                  <Pill tone="brand">{lever}</Pill>
                </li>
              ))}
            </ul>
            {args?.reason ? (
              <p className="mt-2 text-[0.74rem] text-ink-muted">
                {args.reason}
              </p>
            ) : null}
            {!settled ? (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const params = new URLSearchParams();
                    if (args?.status && args.status !== "all") {
                      params.set("status", args.status);
                    }
                    if (args?.sort) params.set("sort", args.sort);
                    if (args?.top) params.set("top", String(args.top));
                    const query = params.toString();
                    router.push(
                      `${skinHref("requests")}${query ? `?${query}` : ""}`,
                    );
                    if (toolCallId) {
                      answeredNavigations.set(toolCallId, { confirmed: true });
                    }
                    respond?.(
                      "Opened the Requests page with the filters and sort applied. The controls are highlighted on screen.",
                    );
                  }}
                  className="rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-brand-foreground"
                >
                  Open it
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (toolCallId) {
                      answeredNavigations.set(toolCallId, { confirmed: false });
                    }
                    respond?.("The user chose to stay on the current page.");
                  }}
                  className="rounded-md border border-hairline px-3 py-1.5 text-[0.75rem] text-ink-muted hover:text-ink"
                >
                  Stay here
                </button>
              </div>
            ) : null}
          </ToolCard>
        );
      },
    },
    [],
  );

  // ══ BEAT 5 — THE STORED PROCEDURE'S THREE WRITES ═════════════════════════
  // Registered globally so the procedure can run from any page. Each produces a
  // change the audience can SEE on the roster and the onboarding page.

  useFrontendTool(
    {
      name: "createOnboardingTasks",
      description:
        "Build the standard onboarding checklist for one person. Idempotent — " +
        "re-running replaces the checklist rather than duplicating it.",
      parameters: z.object({ employee: z.string() }),
      handler: async ({ employee }) => {
        const person = findPerson(employee);
        if (!person) return `No one on the roster matches "${employee}".`;
        const res = await fetch(
          `/api/people/v1/employees/${person.id}/onboarding-tasks`,
          { method: "POST" },
        );
        if (!res.ok)
          return `Could not build the checklist (HTTP ${res.status}).`;
        const created = (await res.json()) as unknown[];
        await refresh();
        recording.logStep(`Built the onboarding checklist for ${person.name}`);
        return `Built a ${created.length}-step onboarding checklist for ${person.name}.`;
      },
      render: ({ result, args }) =>
        result ? (
          <Receipt>{String(result)}</Receipt>
        ) : (
          <ToolCard>
            <p className="text-[0.78rem] text-ink-muted">
              Building the checklist for {args?.employee}…
            </p>
          </ToolCard>
        ),
    },
    [],
  );

  useFrontendTool(
    {
      name: "assignBuddy",
      description:
        "Pair a new hire with an onboarding buddy. Choose an experienced " +
        "teammate on the same team who is not their manager.",
      parameters: z.object({
        employee: z.string().describe("The new hire's name or id."),
        buddy: z.string().describe("The buddy's name or id."),
      }),
      handler: async ({ employee, buddy }) => {
        const person = findPerson(employee);
        const mate = findPerson(buddy);
        if (!person) return `No one on the roster matches "${employee}".`;
        if (!mate) return `No one on the roster matches "${buddy}".`;
        const res = await fetch(`/api/people/v1/employees/${person.id}/buddy`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ buddyId: mate.id }),
        });
        if (!res.ok) return `Could not assign the buddy (HTTP ${res.status}).`;
        await refresh();
        recording.logStep(`Assigned ${mate.name} as ${person.name}'s buddy`);
        return `${mate.name} is now ${person.name}'s onboarding buddy.`;
      },
      render: ({ result }) =>
        result ? <Receipt>{String(result)}</Receipt> : null,
    },
    [],
  );

  useFrontendTool(
    {
      name: "postWelcomeNote",
      description:
        "Post a short welcome note on a new hire's record. Name their team and " +
        "their buddy. Keep it to one sentence.",
      parameters: z.object({
        employee: z.string(),
        text: z.string().describe("The welcome, one sentence."),
      }),
      handler: async ({ employee, text }) => {
        const person = findPerson(employee);
        if (!person) return `No one on the roster matches "${employee}".`;
        // Force the marker. "Use a light or a bell or whatever so people can
        // see that it changed" — a note that reads like every other note is
        // invisible from the back of a room, so the emoji is prepended here
        // rather than left to the model's discretion.
        const marked = text.trim().startsWith("🎉")
          ? text.trim()
          : `🎉 ${text.trim()}`;
        const res = await fetch(`/api/people/v1/employees/${person.id}/notes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: marked,
            author: operatorRef.current.name,
          }),
        });
        if (!res.ok) return `Could not post the note (HTTP ${res.status}).`;
        await refresh();
        recording.logStep(`Posted a welcome note for ${person.name}`);
        return `Posted the welcome note on ${person.name}'s record.`;
      },
      render: ({ result }) =>
        result ? <Receipt>{String(result)}</Receipt> : null,
    },
    [],
  );

  // ── Distractors ──────────────────────────────────────────────────────────
  // Plausible, real, and useless for both the stored procedure and the gate.
  // They are what make "it picked the right three" and "it cleared the gate"
  // mean something rather than being the only options available.
  useFrontendTool(
    {
      name: "requestBackgroundCheck",
      description: "Order a background check for a new hire.",
      parameters: z.object({ employee: z.string() }),
      handler: async ({ employee }) =>
        `Background check ordered for ${findPerson(employee)?.name ?? employee}.`,
      render: ({ result }) =>
        result ? <Receipt>{String(result)}</Receipt> : null,
    },
    [],
  );

  useFrontendTool(
    {
      name: "scheduleExitInterview",
      description: "Schedule an exit interview for someone who is leaving.",
      parameters: z.object({ employee: z.string() }),
      handler: async ({ employee }) =>
        `Exit interview scheduled for ${findPerson(employee)?.name ?? employee}.`,
      render: ({ result }) =>
        result ? <Receipt>{String(result)}</Receipt> : null,
    },
    [],
  );

  useFrontendTool(
    {
      name: "sendPolicyReminder",
      description: "Send someone a reminder about a People Ops policy.",
      parameters: z.object({ employee: z.string(), topic: z.string() }),
      handler: async ({ employee, topic }) =>
        `Reminder about ${topic} sent to ${findPerson(employee)?.name ?? employee}.`,
      render: ({ result }) =>
        result ? <Receipt>{String(result)}</Receipt> : null,
    },
    [],
  );

  useFrontendTool(
    {
      name: "openHeadcountRequisition",
      description: "Open a new headcount requisition for a team.",
      parameters: z.object({ team: z.string(), title: z.string() }),
      handler: async ({ team, title }) =>
        `Requisition opened: ${title} on ${team}.`,
      render: ({ result }) =>
        result ? <Receipt>{String(result)}</Receipt> : null,
    },
    [],
  );

  // ══ BEAT 3d — MULTIMODAL IN, DURABLE ARTIFACT OUT ════════════════════════
  useFrontendTool(
    {
      name: "createOnboardingPacket",
      description:
        "File an onboarding packet for a new hire into the app. When the user " +
        "has attached an offer letter, read it and carry its real details — " +
        "start date, level, manager, week-one schedule — into this call.",
      parameters: z.object({
        employee: z.string(),
        summary: z
          .string()
          .describe("Two sentences on who they are and what they will do."),
        highlights: z
          .array(z.string())
          .max(3)
          .describe("At most three short facts worth surfacing."),
        schedule: z
          .array(z.object({ day: z.string(), item: z.string() }))
          .describe(
            'Week-one schedule, e.g. [{ day: "Day 1", item: "Laptop and badge" }].',
          ),
      }),
      handler: async ({ employee, summary, highlights, schedule }) => {
        const person = findPerson(employee);
        if (!person) return `No one on the roster matches "${employee}".`;
        const res = await fetch("/api/people/v1/packets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            employeeId: person.id,
            summary,
            highlights,
            schedule,
            filedBy: operatorRef.current.name,
          }),
        });
        if (!res.ok) return `Could not file the packet (HTTP ${res.status}).`;
        await refresh();
        return `Filed the onboarding packet for ${person.name}. It is on the Onboarding page under Packets.`;
      },
      render: ({ result, args }) =>
        result ? (
          <Receipt>
            {String(result)}{" "}
            <span className="text-ink-muted">
              It belongs to the app, so deleting this conversation will not
              remove it.
            </span>
          </Receipt>
        ) : (
          <ToolCard>
            <p className="text-[0.78rem] text-ink-muted">
              Filing the packet for {args?.employee}…
            </p>
          </ToolCard>
        ),
    },
    [],
  );

  // ══ BEAT 6 — THE GATE, THE UNLOCK, AND THE TEACH CHAIN ═══════════════════

  useFrontendTool(
    {
      name: "approveCompRequest",
      description:
        "Approve a pending compensation request, writing the new salary and " +
        "level onto the person.",
      parameters: z.object({
        compRequestId: z
          .string()
          .describe("The comp request id, e.g. cmp-marcus."),
      }),
      handler: async ({ compRequestId }) => {
        const res = await fetch(
          `/api/people/v1/comp-requests/${compRequestId}/approve`,
          { method: "POST" },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          recording.logStep("Approve refused");
          // The refusal is passed through VERBATIM and is symptom-only. Do not
          // append a hint here — the agent must not be able to derive the
          // unlock from the error, or beat 6 stops proving that it learned.
          return `REFUSED (${body?.error ?? res.status}): ${body?.message ?? "Approval refused."}`;
        }
        await refresh();
        const name = body?.employee?.name ?? "the employee";
        recording.logStep(`Approved the compensation request for ${name}`);
        return `Approved. ${name} is now ${body?.employee?.level ?? ""} at the requested salary.`;
      },
      render: ({ result, args }) => {
        if (!result) {
          return (
            <ToolCard>
              <p className="text-[0.78rem] text-ink-muted">
                Approving {args?.compRequestId}…
              </p>
            </ToolCard>
          );
        }
        const refused = String(result).startsWith("REFUSED");
        return (
          <Receipt
            tone={refused ? "negative" : "positive"}
            icon={
              refused ? <CircleAlert className="mt-0.5 h-4 w-4" /> : undefined
            }
          >
            {String(result).replace(/^REFUSED \([^)]+\): /, "")}
          </Receipt>
        );
      },
    },
    [],
  );

  useFrontendTool(
    {
      name: "openBandException",
      description:
        "File a band exception against a compensation request under a given code.",
      parameters: z.object({
        compRequestId: z.string(),
        code: z.string().describe("The exception code to file under."),
        justification: z.string(),
      }),
      handler: async ({ compRequestId, code, justification }) => {
        const res = await fetch("/api/people/v1/band-exceptions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ compRequestId, code, justification }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return `REFUSED: ${body?.message ?? res.status}`;
        await refresh();
        return `Filed a band exception (${code}). Exception id ${body?.id}. It still needs finalizing.`;
      },
      render: ({ result }) =>
        result ? (
          <Receipt
            tone={
              String(result).startsWith("REFUSED") ? "negative" : "positive"
            }
          >
            {String(result).replace(/^REFUSED: /, "")}
          </Receipt>
        ) : null,
    },
    [],
  );

  useFrontendTool(
    {
      name: "finalizeBandException",
      description: "Finalize a draft band exception so it takes effect.",
      parameters: z.object({ exceptionId: z.string() }),
      handler: async ({ exceptionId }) => {
        const res = await fetch(
          `/api/people/v1/band-exceptions/${exceptionId}/finalize`,
          { method: "POST" },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return `REFUSED: ${body?.message ?? res.status}`;
        await refresh();
        return `Finalized the ${body?.code ?? ""} band exception.`;
      },
      render: ({ result }) =>
        result ? (
          <Receipt
            tone={
              String(result).startsWith("REFUSED") ? "negative" : "positive"
            }
          >
            {String(result).replace(/^REFUSED: /, "")}
          </Receipt>
        ) : null,
    },
    [],
  );

  // ── The teach chain: offer → watch → save ────────────────────────────────
  useHumanInTheLoop(
    {
      followUp: true,
      name: "offerWorkflowRecording",
      description:
        "Call this when you have hit a refusal you have no saved procedure " +
        "for. Say plainly that you do not know this one and offer to watch the " +
        "user do it. Never guess a workaround instead of calling this.",
      parameters: z.object({
        situation: z
          .string()
          .describe("What you were blocked on, in one line."),
      }),
      render: ({ args, respond, result }) => {
        // Settled. Render a HUMAN line, never `result` — that string is an
        // internal directive addressed to the agent ("Call awaitDemonstration
        // now and wait…") and printing it verbatim puts the demo's own wiring
        // on screen in front of the audience.
        if (typeof result === "string") {
          const agreed = /agreed to demonstrate/i.test(result);
          return (
            <ToolCard>
              <p className="text-[0.78rem] text-ink-muted">
                {agreed
                  ? "Watching you do it once."
                  : "Left it for now — nothing was recorded."}
              </p>
            </ToolCard>
          );
        }
        return (
          <ToolCard>
            <p className="text-[0.8rem]">
              I don&rsquo;t have a saved way to do this yet
              {args?.situation
                ? ` — ${args.situation.replace(/\.+$/, "")}`
                : ""}
              . Want to show me once, and I&rsquo;ll remember it?
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() =>
                  respond?.(
                    "The user agreed to demonstrate. Call awaitDemonstration now and wait — do not guess any steps.",
                  )
                }
                className="rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-brand-foreground"
              >
                Show me
              </button>
              <button
                type="button"
                onClick={() =>
                  respond?.("The user declined to demonstrate. Stop here.")
                }
                className="rounded-md border border-hairline px-3 py-1.5 text-[0.75rem] text-ink-muted hover:text-ink"
              >
                Not now
              </button>
            </div>
          </ToolCard>
        );
      },
    },
    [],
  );

  useHumanInTheLoop(
    {
      followUp: true,
      name: "awaitDemonstration",
      description:
        "Hold the conversation while the user demonstrates. Do NOT list steps " +
        "or suggest what they should do — you do not know yet. That is the point.",
      parameters: z.object({}),
      render: ({ respond, result }) => {
        // Same rule as above: `result` is the raw observed-steps directive
        // written for the agent. Summarize it for the human instead.
        if (typeof result === "string") {
          const count = (result.match(/\d+\.\s/g) ?? []).length;
          return (
            <ToolCard tone="positive">
              <p className="text-[0.78rem]">
                Recorded {count > 0 ? `${count} steps` : "the demonstration"}.
              </p>
            </ToolCard>
          );
        }
        return <DemonstrationCard onDone={(summary) => respond?.(summary)} />;
      },
    },
    [],
  );

  useHumanInTheLoop(
    {
      followUp: true,
      name: "saveLearnedProcedure",
      description:
        "Summarize what you just watched as a numbered procedure and show it " +
        "for confirmation. After the user confirms, persist it with save_memory " +
        "(scope 'user', kind 'operational'). Save it AT MOST ONCE.",
      parameters: z.object({
        procedure: z
          .string()
          .describe(
            "The numbered procedure, naming the exact code that worked.",
          ),
      }),
      render: ({ args, respond, result }) => {
        if (typeof result === "string") {
          return (
            <Receipt>
              Saved. I&rsquo;ll use this next time without being asked.
            </Receipt>
          );
        }
        return (
          <ToolCard>
            <p className="text-[0.78rem] font-medium">
              Here&rsquo;s what I picked up — shall I remember it?
            </p>
            <pre className="mt-2 whitespace-pre-wrap rounded-md bg-surface-muted p-2.5 text-[0.73rem] leading-relaxed text-ink">
              {args?.procedure}
            </pre>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() =>
                  respond?.(
                    "The user confirmed. Persist this with save_memory now (scope 'user', kind 'operational'), then say in one sentence that you have it.",
                  )
                }
                className="rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-brand-foreground"
              >
                Remember it
              </button>
              <button
                type="button"
                onClick={() =>
                  respond?.(
                    "The user declined to save it. Do not call save_memory.",
                  )
                }
                className="rounded-md border border-hairline px-3 py-1.5 text-[0.75rem] text-ink-muted hover:text-ink"
              >
                Don&rsquo;t save
              </button>
            </div>
          </ToolCard>
        );
      },
    },
    [],
  );

  return null;
}

/**
 * BEAT 3a's card. The figure lives in local state and goes straight to REST;
 * it is never lifted into a tool argument, a respond() string, or the
 * transcript. The band range is shown so the user can see they are inside it —
 * the same policy beat 6's gate enforces, surfaced rather than hidden.
 */
function SalaryCard({
  employeeQuery,
  find,
  bands,
  onDone,
  onCancel,
}: {
  employeeQuery: string;
  find: (needle: string) => Employee | undefined;
  bands: PeopleStoreState["bands"];
  onDone: (person: Employee, salary: number) => Promise<void>;
  onCancel: () => void;
}) {
  const person = find(employeeQuery);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  if (!person) {
    return (
      <ToolCard tone="negative">
        <p className="text-[0.8rem] text-ink-muted">
          I couldn&rsquo;t find anyone matching “{employeeQuery}”.
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 rounded-md border border-hairline px-3 py-1.5 text-[0.75rem]"
        >
          Close
        </button>
      </ToolCard>
    );
  }

  const band = bands.find((b) => b.level === person.level);
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  const valid =
    Number.isFinite(parsed) &&
    parsed > 0 &&
    (!band || (parsed >= band.min && parsed <= band.max));

  return (
    <ToolCard>
      <div className="flex items-center gap-2.5">
        <Monogram name={person.name} size="md" />
        <div className="min-w-0">
          <p className="text-[0.82rem] font-semibold">{person.name}</p>
          <p className="text-[0.72rem] text-ink-muted">
            {person.title} · {person.level}
          </p>
        </div>
      </div>

      <label className="mt-3 block">
        <span className="mb-1 block text-[0.7rem] font-medium text-ink-muted">
          New base salary
        </span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          inputMode="numeric"
          autoComplete="off"
          placeholder={band ? `${band.min}–${band.max}` : "Amount"}
          className="rowan-num w-full rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-[0.85rem] text-ink outline-none focus:border-brand/50"
        />
        {band ? (
          <span className="rowan-num mt-1 block text-[0.68rem] text-ink-muted">
            {person.level} band {formatSalary(band.min)}–
            {formatSalary(band.max)} · currently{" "}
            {formatSalary(person.baseSalary)}
          </span>
        ) : null}
      </label>

      <p className="mt-2 text-[0.68rem] text-ink-muted">
        This figure goes straight to the payroll record. The assistant never
        sees it.
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={!valid || saving}
          onClick={async () => {
            setSaving(true);
            await onDone(person, parsed);
          }}
          className="rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-brand-foreground disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-hairline px-3 py-1.5 text-[0.75rem] text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </ToolCard>
  );
}

/**
 * BEAT 6's waiting card. Deliberately NON-DIRECTIONAL: it never lists steps or
 * hints at what to do, because the whole premise is that the agent does not
 * know them. It shows a live "Rec" badge and narrates the steps it observes, so
 * the room can see that watching is really happening.
 */
function DemonstrationCard({ onDone }: { onDone: (summary: string) => void }) {
  const { beginRecording, endRecording, steps, getDemonstratedCode } =
    useRecording();

  // No explicit feed reset: the shell's `beginRecording` clears it when it opens
  // a FRESH window, and deliberately inherits the feed when one is already open
  // (the `opened → finalized → approve` chain arriving as brackets microseconds
  // apart must read as one demonstration). An unconditional reset here would
  // blank a live feed mid-demonstration.
  useEffect(() => {
    beginRecording();
    return () => endRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ToolCard>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-negative-soft px-2 py-0.5 text-[0.68rem] font-semibold text-negative">
          <Radio className="h-3 w-3 animate-pulse" />
          Rec
        </span>
        <p className="text-[0.8rem]">Watching — go ahead and show me.</p>
      </div>

      {steps.length > 0 ? (
        <ol className="mt-2.5 space-y-1 border-l-2 border-brand/30 pl-3">
          {steps.map((step, index) => (
            <li key={step.id} className="text-[0.74rem] text-ink">
              <span className="rowan-num mr-1.5 text-ink-muted">
                {index + 1}.
              </span>
              {step.label}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-[0.72rem] text-ink-muted">
          Nothing captured yet.
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          const code = getDemonstratedCode();
          const observed = steps
            .map((s, i) => `${i + 1}. ${s.label}`)
            .join("\n");
          onDone(
            `The user finished. Observed steps:\n${observed || "(nothing captured)"}\n` +
              (code
                ? `The exception code they used was ${code}.`
                : "No exception code was captured."),
          );
        }}
        className="mt-3 rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-brand-foreground"
      >
        I&rsquo;m done
      </button>
    </ToolCard>
  );
}

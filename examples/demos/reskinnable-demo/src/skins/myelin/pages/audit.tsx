"use client";

import { useEffect } from "react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { BellRing, Megaphone, Sparkles } from "lucide-react";
import { useMyelinLedger } from "../data/ledger-context";
import { relativeTime } from "../data/derive";
import { Avatar, Card, PageHeader, useNow } from "../components/primitives";

/**
 * Audit log — every change, by whom, including the agent's. Governance for an
 * agent that edits production configuration is mostly this: the agent's writes
 * land in the same log as a human's, attributed, and nothing it does is
 * off the record.
 */
export function AuditPage() {
  const { data, loaded, setLocation } = useMyelinLedger();
  const now = useNow(5000);
  useEffect(() => setLocation("audit", null), [setLocation]);

  useAgentContext({
    description:
      "What the Audit log page is showing: the latest changes, manager notifications and scheduled reminders.",
    value: JSON.stringify({
      page: "Audit log",
      latestChanges: data.activity.slice(0, 15).map((a) => a.text),
      byAgent: data.activity.filter((a) => a.actor === "agent").length,
      byAdmins: data.activity.filter((a) => a.actor !== "agent").length,
      notificationsSent: data.notifications.length,
      remindersScheduled: data.reminders.length,
    }),
  });

  if (!loaded) return <p className="text-sm text-ink-muted">Loading…</p>;

  const journeyName = (id: string | null) =>
    data.journeys.find((j) => j.id === id)?.name ?? "";

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle="Every change to program configuration — by admins and by the agent — attributed and timestamped."
      />
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <h2 className="text-sm font-semibold text-ink">Changes</h2>
          {data.activity.length === 0 ? (
            <p className="mt-3 text-[0.8rem] text-ink-muted">
              Nothing has changed yet this session.
            </p>
          ) : (
            <ol className="mt-3 space-y-2.5">
              {data.activity.map((a) => {
                const who = data.admins.find((x) => x.id === a.actor);
                return (
                  <li
                    key={a.id}
                    className="flex items-start gap-2.5 text-[0.78rem]"
                  >
                    {who ? (
                      <Avatar admin={who} size="sm" />
                    ) : (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                        <Sparkles className="h-3 w-3" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-ink">{a.text}</div>
                      {a.journeyId ? (
                        <div className="text-[0.68rem] text-ink-muted">
                          {journeyName(a.journeyId)}
                        </div>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-[0.66rem] text-ink-muted">
                      {relativeTime(a.at, now)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
        <div className="space-y-5">
          <Card>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Megaphone className="h-4 w-4 text-brand" /> Manager notifications
            </h2>
            {data.notifications.length === 0 ? (
              <p className="mt-3 text-[0.78rem] text-ink-muted">None sent.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {data.notifications.map((n) => (
                  <li key={n.id} className="text-[0.76rem]">
                    <div className="font-semibold text-ink">{n.audience}</div>
                    <div className="text-ink-muted">
                      {journeyName(n.journeyId)} · {relativeTime(n.sentAt, now)}
                    </div>
                    <p className="mt-1 text-ink">{n.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <BellRing className="h-4 w-4 text-brand" /> Scheduled nudges
            </h2>
            {data.reminders.length === 0 ? (
              <p className="mt-3 text-[0.78rem] text-ink-muted">
                None scheduled.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {data.reminders.map((r) => (
                  <li key={r.id} className="text-[0.76rem]">
                    <div className="font-semibold text-ink">
                      Day {r.afterDays} · {journeyName(r.journeyId)}
                    </div>
                    <p className="mt-0.5 text-ink">{r.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

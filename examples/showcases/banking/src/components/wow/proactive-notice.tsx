"use client";

import { useEffect, useMemo, useState } from "react";
import useCreditCards from "@/app/actions";
import { Button } from "@/components/ui/button";
import { useAskCopilot } from "./use-ask-copilot";

// How long after page paint the notice appears. The beat matters: the
// dashboard renders first, then the copilot "notices" — arriving together
// reads as a static banner, arriving late reads as an agent observation.
const APPEAR_DELAY_MS = 1200;

// Dismissal is per page load (component state), NOT persisted: the notice is
// the demo's opening beat, so every fresh load must fire it again. Within a
// load it never re-nags — the wrapper stays mounted across client-side route
// changes, so the `engaged` flag survives navigation until a hard reload.

/**
 * Proactive copilot opener: on load, when pending charges have breached their
 * policy limit, the copilot surfaces the observation unprompted and offers to
 * walk through them. Accepting opens the docked panel and sends the request on
 * the user's behalf — the same addMessage + runAgent path a suggestion-pill
 * click takes, so the conversation reads exactly as if the user had asked.
 *
 * The offer deliberately asks the agent to REVIEW the breaches (which renders
 * the interactive pending-approvals queue), not to clear them: clearing an
 * over-limit charge is the teach-mode arc's territory, and this notice must
 * work identically before and after the agent has learned that procedure.
 */
export function ProactiveNotice() {
  const { policies, transactions } = useCreditCards();
  const askCopilot = useAskCopilot();

  const [visible, setVisible] = useState(false);
  const [engaged, setEngaged] = useState(false);

  // Same over-limit formula the agent context uses: over the policy limit and
  // not already covered by an active exception.
  const breachedCount = useMemo(
    () =>
      transactions.filter((t) => {
        if (t.status !== "pending") return false;
        const policy = policies.find((p) => p.id === t.policyId);
        return (
          !!policy &&
          policy.spent + Math.abs(t.amount) > policy.limit &&
          !t.activeExceptionId
        );
      }).length,
    [transactions, policies],
  );

  useEffect(() => {
    if (engaged || breachedCount === 0) return;
    const timer = setTimeout(() => setVisible(true), APPEAR_DELAY_MS);
    return () => clearTimeout(timer);
  }, [breachedCount, engaged]);

  if (!visible || engaged || breachedCount === 0) return null;

  const dismiss = () => {
    setEngaged(true);
    setVisible(false);
  };

  const review = () => {
    setEngaged(true);
    setVisible(false);
    void askCopilot(
      "Show me the pending charges that have breached their policy limits and walk me through what needs attention.",
    );
  };

  return (
    <div
      role="status"
      data-testid="proactive-notice"
      className="fixed bottom-24 right-6 z-50 w-[22rem] max-w-[calc(100vw-3rem)] animate-in fade-in slide-in-from-bottom-4 space-y-3 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft"
    >
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-indigo opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-indigo" />
        </span>
        <h3 className="text-sm font-semibold text-ink">
          Your copilot noticed something
        </h3>
      </div>
      <p className="text-sm text-ink-muted">
        {breachedCount === 1
          ? "A pending charge has breached its policy limit."
          : `${breachedCount} pending charges have breached their policy limits.`}{" "}
        Want me to walk you through {breachedCount === 1 ? "it" : "them"}?
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={review}
          data-testid="proactive-notice-review"
          className="rounded-full bg-brand-soft text-brand-indigo hover:bg-brand-soft/70 dark:text-brand-violet"
          variant="outline"
        >
          Review with Copilot
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={dismiss}
          data-testid="proactive-notice-dismiss"
          className="rounded-full bg-surface-muted text-ink-muted hover:bg-surface-muted/70"
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}

export default ProactiveNotice;

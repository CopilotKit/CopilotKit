"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function FollowupApprovalCard({
  to,
  subject,
  body,
  status,
  onRespond,
}: {
  to: string;
  subject: string;
  body: string;
  status: string;
  onRespond: (v: { approved: boolean; body?: string }) => void;
}) {
  const [draft, setDraft] = useState(body);
  // Resync the draft when the agent supplies a new body — adjust during render
  // (no effect needed) per the React "derive state from props" pattern.
  const [seenBody, setSeenBody] = useState(body);
  if (body !== seenBody) {
    setSeenBody(body);
    setDraft(body);
  }
  const done = status === "complete";
  return (
    <div className="rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">
        Draft follow-up — approval needed
      </div>
      <div className="text-muted-foreground">To: {to}</div>
      <div className="text-muted-foreground">Subject: {subject}</div>
      <textarea
        className="mt-2 h-28 w-full rounded-lg border border-input bg-background p-2 text-foreground"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={done}
      />
      {!done ? (
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            onClick={() => onRespond({ approved: true, body: draft })}
          >
            Approve &amp; log
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRespond({ approved: false })}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-2 text-[color:var(--risk-low)]">Logged ✓</div>
      )}
    </div>
  );
}

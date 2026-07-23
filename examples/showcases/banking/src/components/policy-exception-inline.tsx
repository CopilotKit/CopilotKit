"use client";

import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import type { PolicyException } from "@/app/api/v1/data";
import {
  POLICY_EXCEPTION_CODES,
  isJustifying,
  labelForExceptionCode,
} from "@/app/api/v1/policy-exception-codes";
import { useRecording } from "@/components/recording-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// This card exists to CLEAR an over-limit charge, and only a justifying code
// actually lifts the policy-limit gate server-side (see store.hasApprovedException
// + isJustifying). Offering a non-justifying code here is a foot-gun: it files,
// flips the row to "Cleared", but the subsequent approve is rejected 422. So we
// only present the codes that can genuinely authorize the override.
const JUSTIFYING_CODES = POLICY_EXCEPTION_CODES.filter((c) =>
  isJustifying(c.code),
);

const DEFAULT_CODE = JUSTIFYING_CODES[0].code;

type ExceptionResult = {
  ok: boolean;
  data?: PolicyException;
  error?: string;
};

interface Props {
  transactionId: string;
  openPolicyException: (args: {
    transactionId: string;
    code: string;
  }) => Promise<ExceptionResult>;
  finalizePolicyException: (args: {
    exceptionId: string;
  }) => Promise<ExceptionResult>;
  onFiled?: (code: string) => void;
  onCancel?: () => void;
}

/**
 * Inline "file a policy exception" card — the in-chat twin of
 * `PolicyExceptionModal`. Rendered as a chat-card (no `Dialog` chrome) so the
 * officer's whole demonstration happens right in the conversation: see the
 * over-limit symptom, file the exception, watch it get recorded. That's what
 * makes the recorded demonstration feel like "the agent watched me do it here."
 *
 * Behaviour is identical to the modal:
 *  - shows the human label per code (codes persisted; the agent only ever sees
 *    the code, never the label — the learning invariant),
 *  - opens the exception via REST then immediately finalizes it.
 *
 * The submission is bracketed by `beginRecording()` / `endRecording()` so the
 * canvas recording vignette pulses while the demonstration is captured.
 */
export function PolicyExceptionInline(props: Props) {
  const [code, setCode] = useState<string>(DEFAULT_CODE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneId, setDoneId] = useState<string | null>(null);

  const { beginRecording, endRecording, noteDemonstratedCode, logStep } =
    useRecording();

  const submitDisabled = busy || code === "";

  const handleSubmit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    beginRecording();
    try {
      const opened = await props.openPolicyException({
        transactionId: props.transactionId,
        code,
      });
      if (!opened.ok || !opened.data) {
        setError(opened.error ?? "Failed to open policy exception");
        return;
      }
      const exceptionId = opened.data.id;

      const finalized = await props.finalizePolicyException({ exceptionId });
      if (!finalized.ok) {
        setError(finalized.error ?? "Failed to finalize policy exception");
        return;
      }

      // Surface the demonstrated code to the teach-mode context so the chat's
      // awaitDashboardDemonstration card can report it to the agent — the
      // demonstration happens on the dashboard, outside the chat HITL flow.
      noteDemonstratedCode(code);
      // Narrate the filing into the recorder HUD.
      logStep("Filed the policy exception");
      setDoneId(exceptionId);
      props.onFiled?.(code);
    } finally {
      setBusy(false);
      endRecording();
    }
  };

  if (doneId !== null) {
    return (
      <div className="flex w-full items-center gap-2.5 rounded-2xl bg-positive-soft px-3.5 py-3 text-sm text-ink ring-1 ring-inset ring-positive/30">
        <CheckCircle2 className="size-5 flex-shrink-0 text-positive" />
        <span>
          Exception <span className="font-mono font-medium">{doneId}</span>{" "}
          filed ({labelForExceptionCode(code)}). You can approve now.
        </span>
      </div>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-ink">
          File a policy exception
        </p>
        <p className="text-xs text-ink-muted">
          This transaction is over its policy limit. File an exception to
          proceed.
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="exception-code-inline" className="text-xs">
          Code
        </Label>
        <Select value={code} onValueChange={setCode}>
          <SelectTrigger id="exception-code-inline">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {JUSTIFYING_CODES.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                <span className="font-mono text-xs text-ink-muted">
                  {c.code}
                </span>
                <span className="ml-2">{c.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSubmit()}
          disabled={submitDisabled}
          className="flex-1"
        >
          {busy ? "Filing…" : "File exception"}
        </Button>
        {props.onCancel && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={props.onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
        )}
      </div>

      {error !== null ? (
        <p className="rounded-xl bg-negative-soft px-3.5 py-2.5 text-sm text-negative ring-1 ring-inset ring-negative/30">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default PolicyExceptionInline;

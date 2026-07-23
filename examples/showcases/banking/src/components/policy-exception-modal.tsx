"use client";

import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import type { PolicyException } from "@/app/api/v1/data";
import {
  POLICY_EXCEPTION_CODES,
  labelForExceptionCode,
} from "@/app/api/v1/policy-exception-codes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEFAULT_CODE = POLICY_EXCEPTION_CODES[0].code;

type ExceptionResult = {
  ok: boolean;
  data?: PolicyException;
  error?: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactionId: string;
  openPolicyException: (args: {
    transactionId: string;
    code: string;
  }) => Promise<ExceptionResult>;
  finalizePolicyException: (args: {
    exceptionId: string;
  }) => Promise<ExceptionResult>;
}

/**
 * "File a policy exception" form, opened against a single transaction that
 * the caller has already selected (the transactions view passes the id in,
 * so there is no order/transaction combobox here).
 *
 * Each exception carries a string `code` (e.g. `EXC-BOARD-APPROVED`) instead
 * of a free-text reason. Some catalogue codes justify approval of the
 * policy-limit override; the rest are filed for the record but do not
 * constitute a standing justification (see
 * `api/v1/policy-exception-codes.ts`). The dropdown shows the human label so
 * the officer knows what they are picking; only the code is persisted, and
 * the agent only ever sees the code — never the label.
 *
 * Submitting opens the exception via REST and, on success, immediately
 * finalizes it (auto-approves and links it to the transaction's
 * `activeExceptionId`). From the next click onward the policy-limit gate is
 * lifted for that transaction — but only if the chosen code is justifying.
 *
 * Presentational only: REST calls (passed in from the page's `useCreditCards`
 * hook to avoid duplicate polling). No agent tools live here.
 */
export const PolicyExceptionModal = (props: Props) => {
  const [code, setCode] = useState<string>(DEFAULT_CODE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneId, setDoneId] = useState<string | null>(null);

  const submitDisabled = busy || code === "";

  const resetState = (): void => {
    setCode(DEFAULT_CODE);
    setError(null);
    setBusy(false);
    setDoneId(null);
  };

  const handleClose = (): void => {
    props.onOpenChange(false);
    // Defer state reset until the close animation settles.
    window.setTimeout(resetState, 200);
  };

  const handleSubmit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
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

      setDoneId(exceptionId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) handleClose();
        else props.onOpenChange(true);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New policy exception</DialogTitle>
          <DialogDescription>
            File a policy exception against this transaction.
          </DialogDescription>
        </DialogHeader>

        {doneId === null ? (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="exception-code">Code</Label>
              <Select value={code} onValueChange={setCode}>
                <SelectTrigger id="exception-code">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POLICY_EXCEPTION_CODES.map((c) => (
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

            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitDisabled}
              className="mt-2"
            >
              {busy ? "Filing…" : "File exception"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-4">
            <div className="flex w-full items-center gap-2.5 rounded-2xl bg-positive-soft px-3.5 py-3 text-sm text-ink ring-1 ring-inset ring-positive/30">
              <CheckCircle2 className="size-5 flex-shrink-0 text-positive" />
              <span>
                Exception{" "}
                <span className="font-mono font-medium">{doneId}</span> filed (
                {labelForExceptionCode(code)}).
              </span>
            </div>
            <Button type="button" variant="secondary" onClick={handleClose}>
              Close
            </Button>
          </div>
        )}

        {error !== null ? (
          <p className="rounded-xl bg-negative-soft px-3.5 py-2.5 text-sm text-negative ring-1 ring-inset ring-negative/30">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

export default PolicyExceptionModal;

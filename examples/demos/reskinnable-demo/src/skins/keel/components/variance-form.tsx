"use client";

import { useMemo, useState } from "react";
import { useRecording } from "@/shell/teach";
import { cn } from "@/lib/utils";
import { useRole } from "@/skins/keel/role-context";
import { useKeelLedger } from "@/skins/keel/ledger-context";
import { gatedRevisions } from "@/skins/keel/data/release-authority";
import {
  VARIANCE_CODES,
  VARIANCE_CODE_LABELS,
} from "@/skins/keel/data/variance-codes";

/**
 * BEAT 6 — the OPERATOR-FACING publication-variance filing form.
 *
 * This is the ONE surface in the skin where the variance-code vocabulary may
 * legitimately appear, and the asymmetry is the entire beat: a HUMAN reads this
 * menu, the agent does not. Keel holds no readable, no schema enum, no tool
 * description, no prompt sentence and no error body naming these codes — it
 * learns which one lifts the release gate by WATCHING the operator pick one here.
 * That is why `VARIANCE_CODE_LABELS` exists at all, and why importing it into
 * `tools.tsx` or `agent.ts` is a lint error (`withheldGateVocabulary` in
 * `eslint.config.mjs`); importing it HERE is the sanctioned case. Mirrors
 * `src/skins/logistics/components/escalation-form.tsx`.
 *
 * ── THE MENU IS UNDIFFERENTIATED ON PURPOSE ─────────────────────────────────
 * Justifying codes and decoys are listed together in catalogue order, with no
 * mark, no grouping and no hint of which is which. A form that flagged the
 * working codes would make the demonstration a guided tour: the operator would be
 * following an instruction the app gave them, not exercising knowledge only they
 * have. The two decoys' own labels end "(recorded only)" because that is what
 * they honestly are on the register — it is not a tell about the gate, and an
 * operator who files `COMMITTEE_CALENDAR` will watch the release stay blocked,
 * which is the demonstration working exactly as designed.
 *
 * ── THE RECORDING BRACKETS ──────────────────────────────────────────────────
 * Both write paths bracket themselves with `beginRecording()` / `endRecording()`
 * from the shell's recorder. Those brackets are REF-COUNTED and NESTED inside the
 * outer one `components/demonstration-card.tsx` holds open from "show me" until
 * "I'm done" — that outer bracket is what keeps the feed alive across the two
 * separate clicks and stops the ref count reaching zero between them, which would
 * clear the feed and STRAND the demonstrated code. This form's own brackets exist
 * so the feed and the glow still appear when an operator files a variance off
 * their own bat, with no chat involved.
 *
 * The filing step carries the code as DATA — `logStep(label, code)` — because
 * `getDemonstratedCode()` reads the last CODED step. It is deliberately the code
 * the operator ACTUALLY filed, decoy or not: a recorder that quietly corrected
 * them would report a procedure that was never demonstrated.
 *
 * ⚠️ SCOPE. This is document-control governance, never anything clinical. The
 * gate is about who may RELEASE a revision to the workforce, not about what the
 * policy says.
 */

/** The result line the form shows the operator. `tone` drives the colour only. */
interface Note {
  tone: "positive" | "negative" | "neutral";
  text: string;
}

async function postJson(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; message: string; payload?: unknown }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        payload &&
        typeof payload === "object" &&
        typeof (payload as { message?: unknown }).message === "string"
          ? (payload as { message: string }).message
          : `That request was refused (HTTP ${res.status}).`;
      return { ok: false, message };
    }
    return { ok: true, message: "", payload };
  } catch (error) {
    console.error(`[keel] write to ${url} failed:`, error);
    return {
      ok: false,
      message: "The desk could not be reached. Nothing was recorded.",
    };
  }
}

export function VarianceFilingForm() {
  const { persona } = useRole();
  const { data, refresh } = useKeelLedger();
  const { beginRecording, endRecording, logStep } = useRecording();

  const [docId, setDocId] = useState("");
  const [code, setCode] = useState<string>(VARIANCE_CODES[0]);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  /** The code whose variance this session has filed and ratified, if any. */
  const [filedCode, setFiledCode] = useState<string | null>(null);

  /**
   * Derived through the very same `checkReleaseAuthority` the ROUTE runs, so this
   * form can never offer a case the gate would in fact allow — nor hide one it
   * would refuse. A revision cleared by a ratified justifying variance drops off
   * the list, which is what stops a presenter demonstrating twice on the document
   * they already unlocked.
   */
  const cases = useMemo(
    () => gatedRevisions(data.documents, data.variances),
    [data.documents, data.variances],
  );

  // Fall back to the first case rather than storing a default in state: the
  // ledger arrives asynchronously, so a `useState(cases[0])` would freeze on the
  // empty pre-fetch list forever.
  const selected = cases.find((c) => c.record.docId === docId) ?? cases[0];

  if (!selected) {
    return (
      <p className="rounded-lg border border-dashed border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
        Every revision awaiting release is fully endorsed — nothing on the
        register needs a publication variance right now.
      </p>
    );
  }

  const { record, revision, missing } = selected;
  const filedForThisDocument = filedCode !== null && docId === record.docId;

  const onFile = async () => {
    setBusy(true);
    setNote(null);
    beginRecording();
    logStep(`Opened the variance form on ${record.ref} ${revision}`);
    try {
      // FILE AND RATIFY IN ONE CLICK. A draft variance lifts nothing, so a form
      // that stopped at the draft would demonstrate half a procedure and the
      // release would stay blocked for a reason the room could not see.
      const filed = await postJson("/api/keel/v1/variances", {
        docId: record.docId,
        code,
        rationale,
        personaId: persona.id,
      });
      if (!filed.ok) {
        // A code the catalogue does not hold is refused WITHOUT the catalogue
        // being listed back. Narrated into the feed so the agent sees that the
        // attempt happened and failed — a silent failure would let it conclude
        // the step succeeded.
        logStep(`The variance was refused on ${record.ref}`);
        setNote({ tone: "negative", text: filed.message });
        return;
      }
      const varianceId = (filed.payload as { id?: string } | null)?.id;
      if (!varianceId) {
        logStep(`The variance was refused on ${record.ref}`);
        setNote({
          tone: "negative",
          text: "The register accepted the filing but returned no variance id, so it could not be ratified.",
        });
        return;
      }
      const ratified = await postJson(
        `/api/keel/v1/variances/${encodeURIComponent(varianceId)}/ratify`,
        {},
      );
      if (!ratified.ok) {
        logStep(`The variance could not be ratified on ${record.ref}`);
        setNote({ tone: "negative", text: ratified.message });
        return;
      }
      await refresh();
      // THE CODED STEP. `getDemonstratedCode()` returns the last step carrying a
      // code, so this one call is what the chat's demonstration card reads back.
      logStep(`Filed the publication variance as ${code}`, code);
      setFiledCode(code);
      setDocId(record.docId);
      setNote({
        tone: "neutral",
        text: `Variance ${code} is ratified against ${record.ref} ${revision}. Release the revision to see whether it clears.`,
      });
    } finally {
      endRecording();
      setBusy(false);
    }
  };

  const onRelease = async () => {
    setBusy(true);
    setNote(null);
    beginRecording();
    try {
      const outcome = await postJson(
        `/api/keel/v1/documents/${encodeURIComponent(record.docId)}/release`,
        { personaId: persona.id },
      );
      if (!outcome.ok) {
        // The DECOY path, and it must read as a real refusal rather than an error
        // state: a catalogued code that does not justify files fine, is recorded
        // on the register, and lifts nothing. This is the moment the
        // demonstration teaches which half of the catalogue matters.
        logStep(
          `Re-attempted the release of ${record.ref} ${revision} — still blocked`,
        );
        setNote({ tone: "negative", text: outcome.message });
        return;
      }
      await refresh();
      logStep(
        `Released ${revision} of ${record.ref} to the workforce — the block lifted`,
      );
      setFiledCode(null);
      setNote({
        tone: "positive",
        text: `${revision} of ${record.ref} is released to the workforce.`,
      });
    } finally {
      endRecording();
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4 shadow-soft">
      <p className="text-sm text-ink-muted">
        <span className="font-medium text-ink">
          {record.ref} {revision}
        </span>{" "}
        is waiting on {missing.join(", ") || "an endorsement"}, so it cannot go
        to the workforce. File a publication variance to release it ahead of
        that endorsement.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Document
          <select
            aria-label="Revision needing a variance"
            value={record.docId}
            onChange={(e) => {
              setDocId(e.target.value);
              setFiledCode(null);
              setNote(null);
            }}
            className="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm font-medium text-ink"
          >
            {cases.map((c) => (
              <option key={c.record.docId} value={c.record.docId}>
                {c.record.ref} {c.revision} — {c.record.title}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Variance code
          <select
            aria-label="Variance code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm font-medium text-ink"
          >
            {VARIANCE_CODES.map((c) => (
              <option key={c} value={c}>
                {VARIANCE_CODE_LABELS[c]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-1 flex-col gap-1 text-xs text-ink-muted">
          Why
          <input
            aria-label="Variance rationale"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="One line for the register"
            className="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm text-ink"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onFile()}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
        >
          File variance
        </button>
        {/* Only offered once a variance is ratified for THIS document. The
            release is a separate click on purpose: the room has to see the
            refused write re-attempted and either clear or stay blocked, which is
            what makes the decoy legible. */}
        <button
          type="button"
          disabled={busy || !filedForThisDocument}
          onClick={() => void onRelease()}
          className={cn(
            "rounded-md border px-3 py-1.5 text-xs font-medium",
            filedForThisDocument
              ? "border-brand/50 bg-brand-soft text-brand-indigo hover:opacity-90 dark:text-brand-violet"
              : "border-hairline text-ink-muted",
            "disabled:opacity-50",
          )}
        >
          Release {revision}
        </button>
      </div>

      {note ? (
        <p
          className={cn(
            "text-xs",
            note.tone === "positive" && "text-positive",
            note.tone === "negative" && "text-negative",
            note.tone === "neutral" && "text-ink-muted",
          )}
        >
          {note.text}
        </p>
      ) : null}
    </div>
  );
}

export default VarianceFilingForm;

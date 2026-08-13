"use client";

import { ChatSurface } from "@/skins/keel/components/chat-surface";
import { summarizeRegister } from "@/skins/keel/data/register-summary";
import { SPACE_LABELS } from "@/skins/keel/data/register-levers";
import type { DocumentRecord } from "@/skins/keel/data/types";

/**
 * BEAT 4 — the register summary that OBEYS the seeded reading preference, and is
 * SEEN to obey it.
 *
 * The preference (`intelligence/seed-memories.ts`, and `data/beat-map.md` § Beat
 * 4) names four behaviours a reader in the room can check by looking:
 *
 *   1. GROUPED BY KNOWLEDGE SPACE — Privacy, Clinical, Vendor, in the corpus's own
 *      order. `summarizeRegister` produces exactly those groups.
 *   2. OVERDUE FIRST WITHIN EACH GROUP, then by how far past due. Also
 *      `summarizeRegister`'s ordering, and the rows below are painted in the order
 *      it hands them over — this component applies no sort of its own, so the
 *      preference cannot be claimed and then quietly not applied.
 *   3. COVERAGE AS A WHOLE PERCENT, never a fraction or a ratio. `SummaryRow`
 *      carries `coveragePercent` already rounded; nothing here divides anything.
 *   4. THE OWNING DEPARTMENT BESIDE EVERY REFERENCE — the `owner` line under each
 *      ref.
 *
 * Plus the HONESTY clause, which is the same code path rather than an extra
 * courtesy: a document nobody has been assigned has `coveragePercent === null`,
 * and this card prints "not measurable" for it. Printing 0% would be the app
 * telling the room a policy is unattested when the truth is that nobody looked.
 *
 * ── THE `note` SLOT IS THE BEAT ─────────────────────────────────────────────
 *
 * Without a visible "why", the room sees a perfectly ordinary answer and the beat
 * is INVISIBLE — a grouped list is not evidence of recall, because a model with no
 * memory at all could produce one. The `note` is where the agent names the
 * preference it recalled and applied, in its own words, and it is rendered at the
 * TOP of the card rather than the bottom: it is the claim the rest of the card is
 * evidence for. Banking's `note` parameter is the pattern.
 *
 * ── REPLAY-SAFE BY CONSTRUCTION (beat 2) ────────────────────────────────────
 *
 * Every figure is a pure function of the live ledger plus the snapshot's own
 * `asOf`. Nothing is recovered from the tool `result` and nothing reads `status`,
 * so a reopened thread repaints from the register as it is then — which is the
 * honest reading of "summarize the library".
 */
export function RegisterSummaryCard({
  records,
  now,
  note,
}: {
  records: DocumentRecord[];
  /** The snapshot's own `asOf`, never the wall clock — see `pages/knowledge.tsx`. */
  now: number;
  /**
   * The agent's own sentence naming the saved preference it applied. Prose only —
   * every figure on this card comes from the register, never from the model.
   */
  note?: string;
}) {
  const summary = summarizeRegister(records, now);

  if (records.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-hairline p-3 text-sm text-ink-muted">
        The policy register has not loaded yet.
      </div>
    );
  }

  return (
    <ChatSurface className="rounded-lg border border-hairline bg-surface p-3 shadow-soft">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        The policy library, by knowledge space
      </div>

      {/* The visible "why". Tinted and first, because it is the claim the groups
          below are the evidence for — a note tucked under the rows reads as a
          footnote and the room stops looking for it. */}
      {note && (
        <p
          data-testid="register-summary-note"
          className="mb-3 rounded-md border border-brand/30 bg-brand-soft px-2.5 py-2 text-xs text-brand-indigo dark:text-brand-violet"
        >
          {note}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {summary.groups.map((group) => (
          <div key={group.space}>
            <div className="flex items-baseline justify-between gap-2 border-b border-hairline pb-1">
              <span className="text-xs font-semibold text-ink">
                {SPACE_LABELS[group.space]}
              </span>
              <span className="text-[11px] tabular-nums text-ink-muted">
                {group.rows.length}{" "}
                {group.rows.length === 1 ? "document" : "documents"}
                {group.overdue > 0 ? ` · ${group.overdue} past review` : ""}
              </span>
            </div>

            {/* IN THE ORDER `summarizeRegister` HANDED THEM OVER. Overdue first
                is part of the preference, so re-sorting here would make the beat
                a claim the card quietly does not honour. */}
            <ul className="mt-1 flex flex-col gap-1">
              {group.rows.map((row) => (
                <li
                  key={row.ref}
                  className="flex items-baseline justify-between gap-2 text-xs"
                >
                  <span className="min-w-0">
                    <span className="font-mono text-[11px] font-semibold text-brand">
                      {row.ref}
                    </span>{" "}
                    <span className="text-ink">{row.title}</span>
                    {/* The owning department, beside the ref — clause 4. */}
                    <span className="block text-[11px] text-ink-muted">
                      {row.owner}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    {/* Whole percent, or the honest third rendering. NEVER 0%. */}
                    <span
                      className={
                        row.coveragePercent === null
                          ? "text-[11px] italic text-ink-muted"
                          : "text-[11px] font-semibold tabular-nums text-ink"
                      }
                    >
                      {row.coveragePercent === null
                        ? "coverage not measurable"
                        : `${row.coveragePercent}% attested`}
                    </span>
                    {row.overdue && (
                      <span className="text-[11px] font-semibold text-negative">
                        {row.reviewDebtDays === null
                          ? "past review"
                          : `${row.reviewDebtDays} days past review`}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            {/* Per-group, because "one of these three cannot be measured" is a
                different statement from the register-wide caveat below. */}
            {group.caveat && (
              <p className="mt-1 text-[11px] italic text-ink-muted">
                {group.caveat}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* The register-wide caveat, and ONLY when more than one group carries one.
          With a single affected group its sentence is word-for-word the group
          caveat above, and printing the same honesty clause twice reads as a
          rendering bug rather than as care — which costs the clause its weight at
          the exact moment it matters. */}
      {summary.caveat && summary.groups.filter((g) => g.caveat).length > 1 && (
        <p className="mt-2 border-t border-hairline pt-2 text-[11px] italic text-ink-muted">
          {summary.caveat}
        </p>
      )}
    </ChatSurface>
  );
}

export default RegisterSummaryCard;

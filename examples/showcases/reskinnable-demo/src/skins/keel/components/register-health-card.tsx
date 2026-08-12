"use client";

import { ChatSurface } from "@/skins/keel/components/chat-surface";
import { deriveRegisterKpiTiles } from "@/skins/keel/components/register-kpis";
import { summarizeRegister } from "@/skins/keel/data/register-summary";
import { SPACE_LABELS } from "@/skins/keel/data/register-levers";
import type { DocumentRecord } from "@/skins/keel/data/types";

/**
 * BEAT 1 — the FACE of the keel demo: policy-library health, rendered in the
 * chat transcript as a card rather than described in prose.
 *
 * ── Why every figure here is re-derived, and none is passed in ──────────────
 *
 * The tool that renders this (`showRegisterHealth` in `tools.tsx`) takes NO
 * numbers. It is handed the live register out of the ledger snapshot and the
 * snapshot's own `asOf`, and computes the tiles with `deriveRegisterKpiTiles` —
 * the SAME function the Policy Register page's strip and its beat-3b readable
 * call — and the groups with `summarizeRegister`, the same function beat 4's
 * summary uses. A card that let the model author a percentage would eventually
 * print a number the page beside it disagrees with, and the room would be shown
 * two truths about one register.
 *
 * ── Why that also makes it BEAT 2 (replay-safe) ─────────────────────────────
 *
 * Nothing here reads the tool's `status`, and nothing here is recovered from the
 * tool's `result`: every figure is a pure function of `GET /ledger` plus the
 * instant the server measured it. Reopen the thread tomorrow and the card
 * repaints from the ledger as it is then — which is the honest reading of "how
 * healthy is the library", because that is a claim about NOW and not about the
 * moment somebody asked. The replay-safety property this needs is the weaker
 * one: it must not go BLANK, and a render with no status dependency cannot.
 *
 * ── The coverage tile is the interesting one ────────────────────────────────
 *
 * `deriveRegisterKpiTiles` prints "Not measured" rather than "0%" when nothing
 * in the set is measurable, and the caveat sentence rides beside the tiles
 * whenever any document's coverage is unknown. A document nobody has been
 * assigned has UNKNOWN coverage, not zero, and a card that rounded that to 0%
 * would be the app itself telling the room a policy is unattested when the truth
 * is that nobody looked.
 */
export function RegisterHealthCard({
  records,
  now,
  note,
}: {
  records: DocumentRecord[];
  /** The snapshot's own `asOf`, never the wall clock — see `pages/knowledge.tsx`. */
  now: number;
  /**
   * One sentence of the agent's own framing, e.g. which group it wants the
   * reader to look at first. Prose only: it never carries a figure, because
   * every figure on this card comes from the register.
   */
  note?: string;
}) {
  const tiles = deriveRegisterKpiTiles(records, now);
  const summary = summarizeRegister(records, now);

  if (records.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-hairline p-3 text-sm text-ink-muted">
        The policy register has not loaded yet.
      </div>
    );
  }

  // The widest group, so the bars below are comparable rather than each
  // normalized to itself. Guarded at 1 so a register of empty groups cannot
  // divide by zero.
  const widest = Math.max(1, ...summary.groups.map((g) => g.rows.length));

  return (
    <ChatSurface className="rounded-lg border border-hairline bg-surface p-3 shadow-soft">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        Policy library health
      </div>

      <div className="grid grid-cols-2 gap-2">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-md bg-surface-muted px-2.5 py-2"
          >
            <div className="text-lg font-bold tabular-nums leading-tight text-ink">
              {tile.value}
            </div>
            <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
              {tile.label}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {summary.groups.map((group) => {
          const width = Math.round((group.rows.length / widest) * 100);
          return (
            <div key={group.space}>
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="font-medium text-ink">
                  {SPACE_LABELS[group.space]}
                </span>
                <span className="tabular-nums text-ink-muted">
                  {group.rows.length}{" "}
                  {group.rows.length === 1 ? "document" : "documents"}
                  {group.overdue > 0 ? ` · ${group.overdue} past review` : ""}
                </span>
              </div>
              {/* The bar is the document COUNT; the overdue share is the tinted
                  segment inside it, so "which space carries the review debt" is
                  answerable at a glance without reading either number. */}
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full bg-brand/30"
                  style={{ width: `${width}%` }}
                >
                  <div
                    className="h-full rounded-full bg-negative"
                    style={{
                      width: `${Math.round((group.overdue / Math.max(1, group.rows.length)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {summary.caveat && (
        <p className="mt-2 text-[11px] italic text-ink-muted">
          {summary.caveat}
        </p>
      )}
      {note && <p className="mt-2 text-xs text-ink">{note}</p>}
    </ChatSurface>
  );
}

export default RegisterHealthCard;

"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useKeelHref } from "@/skins/keel/href";
import {
  ATTENTION_LABELS,
  attentionClasses,
  coveragePercent,
  coverageStatus,
  reviewDebtDays,
} from "@/skins/keel/data/attention";
import { SPACE_LABELS } from "@/skins/keel/data/register-levers";
import type { DocumentRecord, RegisterStatus } from "@/skins/keel/data/types";

/**
 * The policy register, painted.
 *
 * It renders EXACTLY the rows it is handed, in the order it is handed them, and
 * applies no filter, cap or sort of its own. That is the whole reason the levers
 * and the beat-3b readable can be trusted against each other: the page runs ONE
 * pipeline and this component is a pure projection of its output. A board that
 * re-sorted its input would make every sort lever a no-op the confirm card still
 * named and the control still tinted — the exact defect logistics shipped and
 * then fixed.
 */

const STATUS_LABELS: Record<RegisterStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  published: "Published",
};

const STATUS_TONES: Record<RegisterStatus, string> = {
  draft: "bg-surface-muted text-ink-muted",
  in_review: "bg-brand-violet/15 text-brand-violet",
  published: "bg-positive/15 text-positive",
};

/**
 * Attestation coverage as the register prints it.
 *
 * "Not measured" is a THIRD rendering, never a grey "0%": a document nobody has
 * been assigned has unknown coverage, and painting that as zero is the strongest
 * claim this board could make about the row it has least right to make
 * (`data/attention.ts` § header). Short and clear are tinted apart so the
 * `attestation_short` lever has something visible to select.
 */
function Coverage({ record }: { record: DocumentRecord }) {
  const status = coverageStatus(record);
  if (status === "unknown") {
    return <span className="text-xs italic text-ink-muted">Not measured</span>;
  }
  return (
    <span
      className={cn(
        "text-sm font-semibold tabular-nums",
        status === "short" ? "text-negative" : "text-ink",
      )}
    >
      {coveragePercent(record)}%
    </span>
  );
}

/**
 * "35 days over" / "in 175 days" / "—". Derived, never stored.
 *
 * The non-finite guard is not theoretical padding: `now` is the snapshot's
 * `asOf`, which is `NaN` until the first read lands. A board with no rows cannot
 * reach this, but "NaN days over" is the worst thing this column could paint and
 * the guard costs one comparison.
 */
function reviewDebtLabel(record: DocumentRecord, now: number): string {
  const debt = reviewDebtDays(record, now);
  if (debt === null || !Number.isFinite(debt)) return "—";
  if (debt > 0) return `${debt} days over`;
  if (debt === 0) return "due today";
  return `in ${Math.abs(debt)} days`;
}

export function RegisterBoard({
  records,
  now,
  showRank,
}: {
  records: DocumentRecord[];
  now: number;
  /** A rank column, drawn only under an explicit sort lever. */
  showRank: boolean;
}) {
  const keelHref = useKeelHref();

  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-surface shadow-soft">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
              {showRank && <th className="px-3 py-2 font-semibold">#</th>}
              <th className="px-3 py-2 font-semibold">Reference</th>
              <th className="px-3 py-2 font-semibold">Document</th>
              <th className="px-3 py-2 font-semibold">Space</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">In force</th>
              <th className="px-3 py-2 font-semibold">Review</th>
              <th className="px-3 py-2 font-semibold">Attestation</th>
              <th className="px-3 py-2 font-semibold">Attention</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record, index) => {
              const classes = attentionClasses(record, now);
              return (
                <tr
                  key={record.docId}
                  className="border-b border-hairline last:border-0 hover:bg-surface-muted"
                >
                  {showRank && (
                    <td className="px-3 py-2 font-mono text-xs text-ink-muted tabular-nums">
                      {index + 1}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    {/* Through `keelHref`, never a literal `/keel/...`: under a
                        LOCK_SKIN deploy this app is served at `/` and a hardcoded
                        prefix would reappear in the address bar on the first
                        click. It is also the same destination an agent citation
                        lands on, so browsing and grounding share one route. */}
                    <Link
                      href={keelHref(`knowledge/${record.docId}`)}
                      className="font-mono text-xs font-semibold text-brand hover:underline"
                    >
                      {record.ref}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className="block font-medium text-ink">
                      {record.title}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {record.owner}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-muted">
                    {SPACE_LABELS[record.space]}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex rounded-sm px-2 py-0.5 text-xs font-semibold",
                        STATUS_TONES[record.status],
                      )}
                    >
                      {STATUS_LABELS[record.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-muted">
                    {record.effectiveRevision ?? "—"}
                    {record.pendingRevision && (
                      <span className="ml-1.5 text-xs text-brand-violet">
                        {record.pendingRevision.label} pending
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="block font-mono text-xs text-ink-muted tabular-nums">
                      {record.reviewDue}
                    </span>
                    <span
                      className={cn(
                        "block text-xs",
                        classes.includes("review_overdue")
                          ? "font-semibold text-negative"
                          : "text-ink-muted",
                      )}
                    >
                      {reviewDebtLabel(record, now)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Coverage record={record} />
                  </td>
                  <td className="px-3 py-2">
                    {classes.length === 0 ? (
                      <span className="text-xs text-ink-muted">Clear</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {classes.map((cls) => (
                          <span
                            key={cls}
                            className="rounded-sm bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-brand"
                          >
                            {ATTENTION_LABELS[cls]}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {records.length === 0 && (
              <tr>
                <td
                  colSpan={showRank ? 9 : 8}
                  className="px-3 py-10 text-center text-sm text-ink-muted"
                >
                  No documents match these levers.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default RegisterBoard;

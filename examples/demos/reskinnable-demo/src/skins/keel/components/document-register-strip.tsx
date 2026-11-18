"use client";

import { cn } from "@/lib/utils";
import {
  ATTENTION_LABELS,
  attentionClasses,
  coveragePercent,
  coverageStatus,
  missingEndorsements,
} from "@/skins/keel/data/attention";
import type { DocumentRecord } from "@/skins/keel/data/types";

/**
 * The register overlay for ONE open document — the lifecycle half of what
 * `GET /api/keel/v1/documents/<docId>` returns beside the prose.
 *
 * It exists so that beat 3b's second ask has something page-specific to be
 * about: "what's on my screen?" on the Register describes a filtered board, and
 * on `knowledge/<docId>` it describes THIS document's review debt, attestation
 * coverage and pending revision. Two different, correct answers is the whole
 * beat, and a document page that rendered only prose would answer the second one
 * with the first one's contents.
 *
 * Rendered only when the register carries a row for the document. A corpus doc
 * with no overlay is not an error — the prose is the primary artifact and the
 * lifecycle is additive — so the strip is simply absent rather than drawn empty.
 */
export function DocumentRegisterStrip({
  record,
  now,
}: {
  record: DocumentRecord;
  now: number;
}) {
  const classes = attentionClasses(record, now);
  const coverage = coverageStatus(record);
  const missing = missingEndorsements(record);

  return (
    <section
      aria-label="Register status"
      className="mx-auto flex w-full max-w-5xl flex-col gap-3 rounded-lg border border-hairline bg-surface p-4 shadow-soft"
    >
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <Fact label="Status" value={record.status.replace("_", " ")} />
        <Fact label="In force" value={record.effectiveRevision ?? "—"} />
        <Fact label="Last reviewed" value={record.lastReviewed} />
        <Fact label="Review due" value={record.reviewDue} />
        <Fact
          label="Attestation"
          // "Not measured", never "0%" — a document nobody is assigned has
          // unknown coverage, and zero is a claim about a measurement that was
          // never taken (`data/attention.ts` § header).
          value={
            coverage === "unknown"
              ? "Not measured"
              : `${coveragePercent(record)}%`
          }
          tone={coverage === "short" ? "negative" : undefined}
        />
      </div>

      {classes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {classes.map((cls) => (
            <span
              key={cls}
              className="rounded-sm bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-brand"
            >
              {ATTENTION_LABELS[cls]}
            </span>
          ))}
        </div>
      )}

      {record.pendingRevision && (
        <div className="rounded-md bg-surface-muted p-3">
          <p className="text-sm font-semibold text-ink">
            {record.pendingRevision.label} awaiting release
          </p>
          <p className="mt-0.5 text-sm text-ink-muted">
            {record.pendingRevision.summary}
          </p>
          {/* The bodies that have not signed. This is the SYMPTOM the release
              gate is allowed to state — who has not endorsed, and nothing about
              how to get past it. */}
          {missing.length > 0 && (
            <p className="mt-1.5 text-xs font-medium text-negative">
              Not yet endorsed by {missing.join(", ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Fact({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "negative";
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      <span
        className={cn(
          "text-sm font-semibold capitalize tabular-nums",
          tone === "negative" ? "text-negative" : "text-ink",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default DocumentRegisterStrip;

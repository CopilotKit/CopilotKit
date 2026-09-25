"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useParams } from "next/navigation";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { getDoc } from "@/skins/keel/knowledge/corpus";
import { DocReader } from "@/skins/keel/components/doc-reader";
import { DocumentRegisterStrip } from "@/skins/keel/components/document-register-strip";
import {
  consumeSectionTarget,
  getSectionTarget,
  subscribeSectionTarget,
} from "@/skins/keel/knowledge/citation-target";
import type { KnowledgeDoc } from "@/skins/keel/knowledge/types";
import { useKeelHref } from "@/skins/keel/href";
import { useKeelLedger } from "@/skins/keel/ledger-context";
import {
  attentionClasses,
  coveragePercent,
  missingEndorsements,
  nullableCoverageShort,
  reviewDebtDays,
} from "@/skins/keel/data/attention";

/**
 * Drive the citation-landing beat for the open document: resolve a target
 * section id, scroll it into view, and briefly highlight it. This is what turns
 * "POL-114 §minimum-necessary" in a chat answer into a concrete spot in the real
 * app — the demo's proof the answer is grounded (spec §11).
 *
 * It reacts to THREE triggers so every navigation path lands:
 *   1. an explicit `requestSection` signal — an in-app citation / openDocument
 *      click, INCLUDING a second citation into the SAME doc, which changes no
 *      observable URL state (stable doc ref + no `hashchange`); this is the case
 *      a hash-only reader silently drops. The signal is SINGLE-USE: the reader
 *      consumes (clears) it once applied, so it cannot be replayed on a later,
 *      hash-less remount of the same doc;
 *   2. a native `hashchange` — an in-page table-of-contents anchor, back/forward;
 *   3. the initial hash on entry — a pasted / deep-linked `/…#<sectionId>`.
 *
 * An unknown fragment is silently ignored (no scroll, no highlight, no error).
 */
function useCitationLanding(doc: KnowledgeDoc | undefined): string | undefined {
  const [highlightSectionId, setHighlightSectionId] = useState<string>();
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const target = useSyncExternalStore(
    subscribeSectionTarget,
    getSectionTarget,
    () => null,
  );

  const applySection = useCallback(
    (sectionId: string | undefined) => {
      if (!doc || !sectionId) return;
      // Ignore a fragment that names a section this document does not have.
      if (!doc.sections.some((section) => section.id === sectionId)) return;

      document
        .getElementById(sectionId)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      setHighlightSectionId(sectionId);

      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(
        () => setHighlightSectionId(undefined),
        1600,
      );
    },
    [doc],
  );

  // Trigger 1 — explicit in-app signal, SINGLE-USE. Apply it only when it names
  // the doc on screen, then CONSUME (clear) it so it cannot outlive this
  // navigation. Because the store is a module singleton but this reader's own
  // guards are component-local (reset on remount), clearing the store is the
  // only "already applied" state that survives a remount — that is what stops a
  // stale target from being replayed when the SAME doc is later re-opened with
  // NO fragment. The cross-doc guard runs BEFORE the consume: a target for
  // another doc is left in place until that doc mounts (its arrival is a `doc`
  // change, which re-runs this effect and then matches), so a cross-doc landing
  // no longer depends solely on the pushed URL carrying `#sectionId`.
  useEffect(() => {
    if (!target || !doc || target.docId !== doc.id) return;
    // This IS the sanctioned "subscribe to an external system, set state in the
    // callback" case (see the rule's own guidance): `target` is a
    // useSyncExternalStore value, and applying it is a one-shot response to a
    // discrete store event, not a render-derived cascade. The hash effect below
    // does the same via a nested closure, which the rule does not flag.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    applySection(target.sectionId);
    consumeSectionTarget();
  }, [target, doc, applySection]);

  // Triggers 2 & 3 — the initial hash on entry, and native `hashchange` (TOC
  // anchors, back/forward). Re-runs whenever the open doc changes, which also
  // covers landing on a DIFFERENT doc that carries a fragment.
  useEffect(() => {
    if (!doc) return;
    const applyFromHash = () =>
      applySection(window.location.hash.slice(1) || undefined);

    applyFromHash();
    window.addEventListener("hashchange", applyFromHash);
    return () => {
      window.removeEventListener("hashchange", applyFromHash);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, [doc, applySection]);

  return highlightSectionId;
}

/**
 * The sectioned document reader page. Deep-linked from agent citations as
 * /keel/knowledge/<docId>#<sectionId>. It reads its own docId from the route
 * (params.rest === ["knowledge", docId]); the target section arrives via
 * {@link useCitationLanding}.
 *
 * It renders BOTH halves of what a document at Harbor Point is — the corpus
 * PROSE (static, from `knowledge/corpus.ts`) and the register OVERLAY (mutable,
 * from the ledger snapshot). That split is the same one
 * `GET /api/keel/v1/documents/<docId>` returns as `{ doc, record }`, and a
 * document with prose but no register row still renders: the strip is simply
 * absent, never drawn empty.
 *
 * BEAT 3b, the SECOND ask. The readable below describes THIS document — its
 * review debt, its attestation coverage, its pending revision and the bodies
 * that have not endorsed it — so "what's on my screen?" answers differently here
 * than it does on the Register. Two different, correct answers on two pages is
 * the entire beat, and a page with no readable of its own answers the second ask
 * with the first page's contents.
 */
export function DocumentPage() {
  const keelHref = useKeelHref();
  // `useParams` reads the MATCHED route, which always carries the `[skin]`
  // segment — a locked deploy's prefix-free URL is rewritten onto it by
  // `src/proxy.ts` before matching. So `rest` is the same shape either way.
  const params = useParams<{ skin: string; rest?: string[] }>();
  const docId = params.rest?.[1];
  // getDoc returns the same corpus object reference for a given id, so `doc` is
  // stable across renders and safe as an effect dependency.
  const doc = docId ? getDoc(docId) : undefined;

  const highlightSectionId = useCitationLanding(doc);

  // The lifecycle half. Read off the SAME snapshot the Register reads, so the
  // two pages cannot describe the register a fetch apart.
  const { data } = useKeelLedger();
  const record = useMemo(
    () => (docId ? data.documents.find((r) => r.docId === docId) : undefined),
    [data.documents, docId],
  );
  // The instant this page describes — the snapshot's OWN `asOf`, never the wall
  // clock, for the three reasons `pages/knowledge.tsx` sets out at length. NaN
  // before a snapshot lands, which is unobservable here because the strip below
  // renders only when the register carries a row.
  const now = useMemo(() => Date.parse(data.asOf), [data.asOf]);

  // Registered UNCONDITIONALLY, before the not-found early return: a hook after
  // a conditional return is a hook-order violation, and "the operator is looking
  // at a document id the library does not carry" is itself worth describing.
  // No semicolons in the description — see the note in `knowledge.tsx`.
  useAgentContext({
    description:
      "What is on the open policy document screen right now — the document " +
      "being read, the sections rendered in order, and its register status. " +
      "This describes ONE document rather than the register board. An " +
      "`attestation_coverage_percent` of null means coverage is NOT MEASURABLE " +
      "for this document rather than zero — say so.",
    value: JSON.stringify({
      page: "Policy document",
      doc_id: docId ?? null,
      found: Boolean(doc),
      ref: doc?.ref ?? null,
      title: doc?.title ?? null,
      owner: doc?.owner ?? null,
      space: doc?.space ?? null,
      // The sections the reader paints, in the order it paints them, plus the
      // one currently highlighted by a citation landing.
      sections: (doc?.sections ?? []).map((section) => ({
        id: section.id,
        heading: section.heading,
      })),
      highlighted_section: highlightSectionId ?? null,
      register: record
        ? {
            status: record.status,
            effective_revision: record.effectiveRevision ?? null,
            last_reviewed: record.lastReviewed,
            review_due: record.reviewDue,
            days_past_review: reviewDebtDays(record, now),
            attestation_coverage_percent: coveragePercent(record),
            attestation_short: nullableCoverageShort(record),
            attention: attentionClasses(record, now),
            pending_revision: record.pendingRevision
              ? {
                  label: record.pendingRevision.label,
                  stage: record.pendingRevision.stage,
                  summary: record.pendingRevision.summary,
                  missing_endorsements: missingEndorsements(record),
                }
              : null,
          }
        : null,
    }),
  });

  if (!doc) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-lg border border-dashed border-hairline bg-surface px-6 py-16 text-center shadow-soft">
        <h1 className="text-lg font-semibold text-ink">Document not found</h1>
        <p className="text-sm text-ink-muted">
          No policy or standard is filed under{" "}
          <span className="font-mono text-ink">{docId ?? "—"}</span>.
        </p>
        <Link
          href={keelHref("knowledge")}
          className="mt-1 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-indigo"
        >
          Back to the register
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {record && <DocumentRegisterStrip record={record} now={now} />}
      <DocReader doc={doc} highlightSectionId={highlightSectionId} />
    </div>
  );
}

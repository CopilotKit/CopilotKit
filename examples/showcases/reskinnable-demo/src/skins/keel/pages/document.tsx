"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useParams } from "next/navigation";
import { getDoc } from "@/skins/keel/knowledge/corpus";
import { DocReader } from "@/skins/keel/components/doc-reader";
import {
  consumeSectionTarget,
  getSectionTarget,
  subscribeSectionTarget,
} from "@/skins/keel/knowledge/citation-target";
import type { KnowledgeDoc } from "@/skins/keel/knowledge/types";
import { useKeelHref } from "@/skins/keel/href";

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
 * /keel/knowledge/<docId>#<sectionId>. It renders NO props from the shell — it
 * reads its own docId from the route (params.rest === ["knowledge", docId]);
 * the target section arrives via {@link useCitationLanding}.
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
          Back to Knowledge
        </Link>
      </div>
    );
  }

  return <DocReader doc={doc} highlightSectionId={highlightSectionId} />;
}

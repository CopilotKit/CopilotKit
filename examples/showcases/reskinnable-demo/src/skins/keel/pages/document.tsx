"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { getDoc } from "@/skins/keel/knowledge/corpus";
import { DocReader } from "@/skins/keel/components/doc-reader";

/**
 * The sectioned document reader page. Deep-linked from agent citations as
 * /keel/knowledge/<docId>#<sectionId>. It renders NO props from the shell — it
 * reads its own docId from the route (params.rest === ["knowledge", docId]) and
 * the target section from the URL fragment (which useParams does not expose).
 *
 * The citation-landing beat: on mount and on every hashchange, resolve the
 * fragment to a section, scroll it into view, and highlight it briefly. This is
 * what turns "POL-114 §minimum-necessary" in a chat answer into a concrete spot
 * in the real app — the demo's proof the answer is grounded (spec §11).
 */
export function DocumentPage() {
  const params = useParams<{ skin: string; rest?: string[] }>();
  const docId = params.rest?.[1];
  // getDoc returns the same corpus object reference for a given id, so `doc` is
  // stable across renders and safe as an effect dependency.
  const doc = docId ? getDoc(docId) : undefined;

  const [highlightSectionId, setHighlightSectionId] = useState<string>();
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!doc) return;

    const applyFromHash = () => {
      const id = window.location.hash.slice(1);
      if (!id) return;
      // Ignore a fragment that names a section this document does not have.
      if (!doc.sections.some((section) => section.id === id)) return;

      document
        .getElementById(id)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      setHighlightSectionId(id);

      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(
        () => setHighlightSectionId(undefined),
        1600,
      );
    };

    applyFromHash();
    window.addEventListener("hashchange", applyFromHash);
    return () => {
      window.removeEventListener("hashchange", applyFromHash);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, [doc]);

  if (!doc) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-lg border border-dashed border-hairline bg-surface px-6 py-16 text-center shadow-soft">
        <h1 className="text-lg font-semibold text-ink">Document not found</h1>
        <p className="text-sm text-ink-muted">
          No policy or standard is filed under{" "}
          <span className="font-mono text-ink">{docId ?? "—"}</span>.
        </p>
        <Link
          href="/keel/knowledge"
          className="mt-1 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-indigo"
        >
          Back to Knowledge
        </Link>
      </div>
    );
  }

  return <DocReader doc={doc} highlightSectionId={highlightSectionId} />;
}

"use client";

import Link from "next/link";
import { KEEL_SPACES, getDocsBySpace } from "@/skins/keel/knowledge/corpus";
import { useKeelHref } from "@/skins/keel/href";

/**
 * The corpus browser: three knowledge spaces, each listing its documents. Every
 * row deep-links into the reader at /keel/knowledge/<docId> — the same route an
 * agent citation lands on, so browsing and grounding share one destination.
 */
export function KnowledgePage() {
  const keelHref = useKeelHref();
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold text-ink">Knowledge</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Harbor Point Health policies and standards. Ask the desk a question to
          get a cited answer, or open a document directly.
        </p>
      </header>

      {KEEL_SPACES.map((space) => {
        const docs = getDocsBySpace(space.id);
        return (
          <section key={space.id} className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
                {space.label}
              </h2>
              <p className="mt-0.5 text-sm text-ink-muted">
                {space.description}
              </p>
            </div>

            <ul className="flex flex-col gap-2">
              {docs.map((doc) => (
                <li key={doc.id}>
                  <Link
                    href={keelHref(`knowledge/${doc.id}`)}
                    className="flex items-center gap-4 rounded-md border border-hairline bg-surface px-4 py-3 shadow-soft transition-colors hover:bg-brand-soft"
                  >
                    <span className="w-20 shrink-0 font-mono text-sm font-semibold text-brand">
                      {doc.ref}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {doc.title}
                      </span>
                      <span className="block text-xs text-ink-muted">
                        {doc.owner} · Updated {doc.updated}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-muted tabular-nums">
                      {doc.sections.length} sections
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

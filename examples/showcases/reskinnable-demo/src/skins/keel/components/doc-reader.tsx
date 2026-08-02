"use client";

import type { KnowledgeDoc } from "@/skins/keel/knowledge/types";

/**
 * The sectioned policy reader. Pure presentation: everything arrives via props,
 * so it is shared verbatim by the Document page (deep-linked, highlights the
 * cited section) with no data-hook or router coupling of its own. Each section
 * wrapper carries `id={section.id}` — the anchor a citation fragment resolves to.
 */
export function DocReader({
  doc,
  highlightSectionId,
}: {
  doc: KnowledgeDoc;
  highlightSectionId?: string;
}) {
  return (
    <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      {/* Sticky section index / table of contents */}
      <aside className="hidden lg:block">
        <nav className="sticky top-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            On this page
          </p>
          <ul className="flex flex-col border-l border-hairline">
            {doc.sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="-ml-px block border-l border-transparent py-1 pl-3 text-sm text-ink-muted transition-colors hover:border-brand hover:text-brand"
                >
                  {section.heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <article className="flex flex-col gap-2">
        <header className="border-b border-hairline pb-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
            <span className="font-mono font-semibold text-brand">{doc.ref}</span>
            <span aria-hidden="true">·</span>
            <span>{doc.owner}</span>
            <span aria-hidden="true">·</span>
            <span>Updated {doc.updated}</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-ink">{doc.title}</h1>
        </header>

        {doc.sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            className={`scroll-mt-6 rounded-lg p-4 transition-colors duration-700 ${
              highlightSectionId === section.id ? "bg-brand-soft" : "bg-transparent"
            }`}
          >
            <h2 className="text-lg font-semibold text-ink">{section.heading}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              {section.body}
            </p>
          </section>
        ))}
      </article>
    </div>
  );
}

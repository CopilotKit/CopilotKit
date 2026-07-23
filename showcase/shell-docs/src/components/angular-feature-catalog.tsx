import { getAngularFeatureDocs } from "@/lib/angular-feature-docs";

/** Render the complete Angular feature set without using another frontend's docs. */
export function AngularFeatureCatalog() {
  return (
    <div className="grid gap-4">
      {getAngularFeatureDocs().map((feature) => (
        <section
          key={feature.id}
          id={feature.id}
          className="scroll-mt-24 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text)]">
                {feature.name}
              </h2>
              <code className="text-xs text-[var(--text-muted)]">
                {feature.id}
              </code>
            </div>
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              Supported
            </span>
          </div>
          <p className="mt-3 text-sm text-[var(--text-secondary)]">
            {feature.description}
          </p>
          <nav
            aria-label={`${feature.name} resources`}
            className="mt-4 flex flex-wrap gap-4 text-sm"
          >
            {feature.runHref ? (
              <a
                className="text-[var(--accent)] underline"
                href={feature.runHref}
              >
                Run example
              </a>
            ) : (
              <span className="text-[var(--text-muted)]">
                Backend demo pending
              </span>
            )}
            <a
              className="text-[var(--accent)] underline"
              href={feature.sourceHref}
            >
              View source
            </a>
            <a
              className="text-[var(--accent)] underline"
              href={feature.apiHref}
            >
              {feature.apiHref === "/reference/angular/public-api"
                ? "API inventory"
                : "API reference"}
            </a>
          </nav>
        </section>
      ))}
    </div>
  );
}

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
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
            <dt className="font-medium text-[var(--text)]">Setup</dt>
            <dd className="text-[var(--text-secondary)]">
              Configure <code>provideCopilotKit</code>, then load this feature's
              standalone component from the source view.
            </dd>
            <dt className="font-medium text-[var(--text)]">Lifecycle</dt>
            <dd className="text-[var(--text-secondary)]">
              Registrations follow the owning injection context and clean up
              when Angular destroys it.
            </dd>
            <dt className="font-medium text-[var(--text)]">Errors</dt>
            <dd className="text-[var(--text-secondary)]">
              The runnable example shows loading, failure, recovery, and
              unsupported backend states without a frontend fallback.
            </dd>
            <dt className="font-medium text-[var(--text)]">Rendering</dt>
            <dd className="text-[var(--text-secondary)]">
              The example supports SSR-safe setup, hydration, and zoneless
              signal updates where browser APIs allow the feature to run.
            </dd>
          </dl>
          <nav
            aria-label={`${feature.name} resources`}
            className="mt-4 flex flex-wrap gap-4 text-sm"
          >
            <a
              className="text-[var(--accent)] underline"
              href={feature.runHref}
            >
              Run example
            </a>
            <a
              className="text-[var(--accent)] underline"
              href={feature.sourceHref}
            >
              Compiling source
            </a>
            <a
              className="text-[var(--accent)] underline"
              href={feature.apiHref}
            >
              Typed API
            </a>
          </nav>
        </section>
      ))}
    </div>
  );
}

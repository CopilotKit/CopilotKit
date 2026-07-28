import type { ShowcaseCellResolution } from "@/lib/frontend-route";

type NonRunnableResolution = Exclude<
  ShowcaseCellResolution,
  { kind: "runnable" }
>;

const TITLES: Record<NonRunnableResolution["kind"], string> = {
  malformed: "Invalid Showcase route",
  "docs-only": "Documentation only",
  "not-supported": "Not supported",
  "not-applicable": "Not applicable",
  quarantined: "Temporarily unavailable",
  "backend-unavailable": "Backend fixture unavailable",
};

/** Render a clear terminal state for a cell that cannot run. */
export function FrontendCellStatus({
  resolution,
}: {
  resolution: NonRunnableResolution;
}) {
  return (
    <section
      role="alert"
      className="mx-auto mt-16 max-w-xl border border-[var(--border)] bg-[var(--bg-surface)] p-6 text-[var(--text)]"
    >
      <h1 className="text-lg font-semibold">{TITLES[resolution.kind]}</h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        {resolution.reason}
      </p>
      {resolution.kind !== "malformed" ? (
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="text-[var(--text-muted)]">Cell</dt>
          <dd className="break-all font-mono">{resolution.cellId}</dd>
          <dt className="text-[var(--text-muted)]">Frontend</dt>
          <dd>{resolution.frontend.name}</dd>
          <dt className="text-[var(--text-muted)]">Backend</dt>
          <dd>{resolution.integrationName}</dd>
          <dt className="text-[var(--text-muted)]">Feature</dt>
          <dd>{resolution.featureName}</dd>
        </dl>
      ) : null}
    </section>
  );
}

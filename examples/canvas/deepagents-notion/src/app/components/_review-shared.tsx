"use client";

/**
 * Shared review-page building blocks: the hero card, subsection wrapper,
 * code block. Each review page (enrichment, charts, hitl, render-tools)
 * imports these so the visual cadence is identical across surfaces.
 */

export function ReviewHero({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-card p-6">
      <p className="mb-2 text-xs font-medium uppercase tracking-widest text-secondary">
        {eyebrow}
      </p>
      <h2 className="text-2xl font-bold text-foreground">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

export function ReviewSubsection({
  eyebrow,
  title,
  body,
  children,
}: {
  eyebrow: string;
  title: string;
  body: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-secondary">
          {eyebrow}
        </span>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
      </div>
      <p className="mb-4 max-w-3xl text-xs leading-relaxed text-muted-foreground">
        {body}
      </p>
      <div className="rounded-xl border bg-muted/30 p-4">{children}</div>
    </div>
  );
}

export function ReviewCodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-card p-4 font-mono text-[11px] leading-relaxed text-foreground/90">
      <code>{children}</code>
    </pre>
  );
}

export function ReviewLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <code className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </code>
      {children}
    </div>
  );
}

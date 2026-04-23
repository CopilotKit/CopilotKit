"use client";
// Feature matrix: one row per feature × integration. Each feature's
// `kind` (primary | testing) determines its visual grouping.
// "testing"-kind features render muted and skip the docs row.
import { FeatureGrid, type CellContext } from "@/components/feature-grid";
import { CellStatus, urlsFor } from "@/components/cell-pieces";
import { CommandCell } from "@/components/command-cell";
import { PackagesSection } from "@/components/packages-section";

function Cell(ctx: CellContext) {
  const isTesting = ctx.feature.kind === "testing";

  // Informational demo (e.g. cli-start) — renders a copy-pasteable command
  // block in place of the Demo/Code links, but still shows the same docs
  // row + E2E badge below so the matrix is consistent.
  if (ctx.demo.command) {
    return <CommandCell ctx={ctx} />;
  }

  const links = urlsFor(ctx);

  return (
    <div
      className={`flex flex-col gap-1 text-[11px] ${isTesting ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-2.5">
        <a
          href={links.demoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap text-[var(--accent)] hover:underline"
        >
          <span className="text-[var(--text-muted)]">Demo</span> <span>↗</span>
        </a>
        <a
          href={links.codeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap text-[var(--accent)] hover:underline"
        >
          <span className="text-[var(--text-muted)]">Code</span>{" "}
          <span>{"</>"}</span>
        </a>
      </div>
      <CellStatus ctx={ctx} />
    </div>
  );
}

export default function Page() {
  return (
    <>
      <FeatureGrid title="Feature Matrix" renderCell={Cell} minColWidth={260} />
      <PackagesSection />
      <Legend />
    </>
  );
}

function Legend() {
  return (
    <div className="px-8 pb-8 mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-[var(--text-muted)]">
      <div className="flex items-center gap-1.5">
        <span className="font-semibold text-[var(--text-secondary)]">
          L1-L4 Strip
        </span>
        per-integration health levels shown in column header
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--ok)]">Up</span>
        L1 health endpoint reachable
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--ok)]">Wired</span>
        L2 agent endpoint responds (non-404)
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--ok)]">Chats</span>
        L3 chat round-trip via Playwright
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--ok)]">Tools</span>
        L4 tool rendering verified (n/a if no tool-rendering demo)
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--text-secondary)]">testing</span>
        rows are muted &amp; hide docs (primary feature = has docs)
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--ok)]">docs-og ✓</span>
        {" / "}
        <span className="text-[var(--text-muted)]">·</span>
        {" / "}
        <span className="text-[var(--danger)]">docs-shell ✗</span>
        {" / "}
        <span className="text-[var(--amber)]">!</span> docs: ok / missing / 404
        / probe error
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--accent)] font-medium">Demo ↗</span>/
        <span className="text-[var(--accent)] font-medium">Code {"</>"}</span>
        open hosted preview / source
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--ok)]">E2E ✓</span>/
        <span className="text-[var(--amber)]">~</span>/
        <span className="text-[var(--danger)]">✗</span>
        end-to-end smoke (green &lt;6h · amber stale · red fail)
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--text-muted)]">?</span>
        probe has not yet ticked since deploy
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--text-muted)]">—</span>
        supported, no demo yet
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--danger)]">✗</span>
        not supported
      </div>
    </div>
  );
}

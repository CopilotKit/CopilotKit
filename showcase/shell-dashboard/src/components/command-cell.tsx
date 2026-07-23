"use client";

// Informational cell — copy-pasteable shell command. Rendered when a demo
// manifest entry declares `command:` instead of a runnable `route:` (e.g.
// the `cli-start` row). Styled to match the dashboard aesthetic.
//
// Renders the command block on top, then the same docs-row + status badges
// the regular cell does so the matrix stays visually consistent across
// informational and runnable demos.

import type { CellContext } from "@/components/feature-grid";

export function CommandCell({ ctx }: { ctx: CellContext }) {
  const command = ctx.demo.command ?? "";
  return (
    <div className="flex flex-col gap-1 text-[11px]">
      <div className="flex items-start gap-1.5">
        <code
          className="flex-1 min-w-0 whitespace-pre-wrap break-all rounded border border-[var(--border)] bg-[var(--bg-muted)] px-2 py-1.5 text-[10.5px] font-mono leading-snug text-[var(--text)]"
          title={command}
        >
          {command}
        </code>
        <CopyButton text={command} />
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  return (
    <button
      type="button"
      onClick={async (e) => {
        const btn = e.currentTarget;
        try {
          await navigator.clipboard.writeText(text);
          const prev = btn.textContent;
          btn.textContent = "✓";
          setTimeout(() => {
            btn.textContent = prev;
          }, 1200);
        } catch {
          /* ignore */
        }
      }}
      className="shrink-0 rounded border border-[var(--border)] px-1.5 py-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] cursor-pointer"
      title="Copy command"
    >
      Copy
    </button>
  );
}

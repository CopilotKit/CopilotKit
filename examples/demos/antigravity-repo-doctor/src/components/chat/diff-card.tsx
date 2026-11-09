"use client";

import { useMemo, useState } from "react";
import { ChevronRight, GitCompareArrows } from "lucide-react";
import { languageOf, parseUnifiedDiff } from "@/lib/diff";
import type { DiffFile } from "@/lib/diff";
import { cn } from "@/lib/cn";
import { DiffView } from "./diff-view";

/** The proposed fix: the workspace's real `git diff`, file by file. */
export function DiffCard({
  summary,
  patch,
}: {
  summary: string;
  patch: string;
}) {
  const files = useMemo(() => parseUnifiedDiff(patch), [patch]);
  const additions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);

  return (
    <section
      className="card enter w-full overflow-hidden"
      data-testid="diff-card"
      data-chat-block="card"
    >
      <header className="flex items-start gap-3 px-4 pt-3.5 pb-3">
        <span className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-lg bg-accent/12 text-accent ring-1 ring-inset ring-accent/25">
          <GitCompareArrows className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow">Proposed fix</p>
            <p className="font-mono text-[14px] tabular-nums text-dim">
              {files.length} {files.length === 1 ? "file" : "files"}
              <span className="ml-2 text-pass">+{additions}</span>
              <span className="ml-1.5 text-fail">−{deletions}</span>
            </p>
          </div>
          <p className="mt-1 text-[16.5px] leading-relaxed text-text/90">
            {summary}
          </p>
        </div>
      </header>
      <div className="border-t border-line">
        {files.map((file, index) => (
          <FileDiff key={file.path} file={file} defaultOpen={index < 2} />
        ))}
      </div>
    </section>
  );
}

function FileDiff({
  file,
  defaultOpen,
}: {
  file: DiffFile;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-tint-1 px-4 py-2 text-left hover:bg-tint-2"
      >
        <ChevronRight
          className={cn(
            "size-4 flex-none text-faint transition-transform",
            open && "rotate-90",
          )}
          aria-hidden
        />
        <span
          className="min-w-0 flex-1 truncate font-mono text-[15px] text-text/90"
          title={file.path}
        >
          {file.path}
        </span>
        <span className="font-mono text-[14px] tabular-nums">
          <span className="text-pass">+{file.additions}</span>
          <span className="ml-1.5 text-fail">−{file.deletions}</span>
        </span>
      </button>
      {open && (
        <DiffView
          hunks={file.hunks}
          lang={languageOf(file.path)}
          className="max-h-[440px] overflow-y-auto border-t border-line bg-bg/40"
        />
      )}
    </div>
  );
}

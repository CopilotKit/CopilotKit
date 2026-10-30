"use client";

import { useState } from "react";
import { JsonView } from "@/components/app/json-view";
import { StaticSurface } from "@/components/app/static-surface";
import { cn } from "@/lib/utils";

type Op = Record<string, unknown>;

/** A macro's expansion: the live render, or the operations that go on the wire. */
export function MacroPreview({ ops, name }: { ops: Op[]; name: string }) {
  const [view, setView] = useState<"render" | "json">("render");
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-[#0b0b0d]">
      <div className="flex h-10 items-center justify-between border-b border-border pl-4 pr-1.5">
        <span className="font-mono text-[12.5px] text-muted-foreground">
          expanded on the server
        </span>
        <div
          role="tablist"
          aria-label={`${name} expansion`}
          className="flex gap-0.5"
        >
          {(["render", "json"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              data-macro-view={v}
              onClick={() => setView(v)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                view === v
                  ? "bg-white/[0.08] text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "render" ? "Render" : "Wire JSON"}
            </button>
          ))}
        </div>
      </div>
      {view === "render" ? (
        <div className="p-6">
          <StaticSurface ops={ops} />
        </div>
      ) : (
        <div className="max-h-[520px] overflow-auto p-5">
          <JsonView value={ops} />
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { CATALOG_ID } from "@/a2ui/catalog/ids";
import { sampleFor, sampleOps } from "@/a2ui/catalog/samples";
import { JsonView } from "@/components/app/json-view";
import { cn } from "@/lib/utils";
import { StagePreview } from "./live-preview";

export type Code = { file: string; html: string | null; raw: string | null };

const TABS = [
  { id: "preview", label: "Preview" },
  { id: "express", label: "Express" },
  { id: "json", label: "A2UI JSON" },
  { id: "definition", label: "Definition" },
  { id: "renderer", label: "Renderer" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/**
 * Preview, the sample as Express and as A2UI JSON, and (for the playground's
 * own components) the Zod definition and the React renderer. Express is the
 * same sample decompiled on the server by `toExpress`.
 */
export function ComponentTabs({
  name,
  intrinsic,
  wide,
  express,
  definition,
  renderer,
}: {
  name: string;
  intrinsic: boolean;
  wide: boolean;
  express: Code;
  definition?: Code;
  renderer?: Code;
}) {
  const [tab, setTab] = useState<TabId>("preview");
  const ops = useMemo(() => {
    const s = sampleFor(name);
    return s ? sampleOps(name, s, CATALOG_ID) : [];
  }, [name]);
  const json = useMemo(() => JSON.stringify(ops, null, 2), [ops]);
  const tabs = TABS.filter((t) => (t.id === "definition" ? !!definition : t.id === "renderer" ? !!renderer : true));
  const code = tab === "express" ? express : tab === "definition" ? definition : tab === "renderer" ? renderer : undefined;

  const copyText = tab === "json" ? json : (code?.raw ?? null);
  const file = tab === "json" ? `${ops.length} ${ops.length === 1 ? "operation" : "operations"}, A2UI v1.0` : (code?.file ?? null);

  return (
    <div>
      <div className="flex h-10 items-center justify-between gap-4 border-b border-border">
        <div role="tablist" aria-label="Component views" className="-mb-px flex h-full min-w-0 items-stretch gap-5 overflow-x-auto [scrollbar-width:none]">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-none whitespace-nowrap border-b-2 text-[13.5px] font-medium transition-colors",
                tab === t.id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {file ? <span className="hidden truncate font-mono text-[11.5px] text-muted-foreground/80 sm:block">{file}</span> : null}
      </div>

      <div className="mt-4">
        {tab === "preview" ? (
          <div data-preview={name} className="docs-stage flex min-h-[360px] items-center justify-center rounded-xl border border-border px-6 py-12 sm:px-10">
            <StagePreview name={name} intrinsic={intrinsic} wide={wide} />
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-xl border border-border bg-[oklch(0.155_0.004_285)]">
            {copyText ? <CopyButton text={copyText} /> : null}
            <div className="docs-scroll max-h-[560px] overflow-auto p-5 pr-14">
              {tab === "json" ? (
                <JsonView value={ops} />
              ) : code ? (
                <CodePane code={code} missing={tab === "express" ? "This sample does not decompile to Express." : undefined} />
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CodePane({ code, missing }: { code: Code; missing?: string }) {
  if (!code.html) {
    return (
      <p className="text-[13px] text-muted-foreground">
        {missing ?? (
          <>
            Could not extract this entry. See <span className="font-mono text-foreground">{code.file}</span>.
          </>
        )}
      </p>
    );
  }
  return <pre className="docs-code" dangerouslySetInnerHTML={{ __html: code.html }} />;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy code"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      className="absolute right-3 top-3 z-10 flex size-7 items-center justify-center rounded-md border border-border bg-background/70 text-muted-foreground transition-colors hover:text-foreground"
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

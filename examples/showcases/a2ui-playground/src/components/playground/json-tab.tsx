"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Pencil } from "lucide-react";
import { ExpressView, JsonView } from "@/components/app/json-view";
import { cn } from "@/lib/utils";
import { useRunStore, type RunRecord } from "@/lib/run-store";
import {
  EditToggle,
  JsonEditPane,
  editorMemory,
  headerButton,
} from "./json-editor";
import { sendable } from "./sendable";

type View = "express" | "json";
const VIEWS: Array<[View, string]> = [
  ["express", "Express"],
  ["json", "JSON"],
];

/** Survives the tab switching away and back (the tab unmounts). */
const viewMemory: { view: View } = { view: "express" };

/** What the composer wrote, when the surface's latest version came from an Express run (the agent's `format:stats` mark carries it). */
function writtenExpress(
  run: RunRecord | undefined,
): { text: string; macros: number } | null {
  const p = run?.payload as
    | (RunRecord["payload"] & { express?: unknown })
    | null
    | undefined;
  return p?.format === "express" && typeof p.express === "string" && p.express
    ? { text: p.express, macros: p.macros }
    : null;
}

/** `renamed`: ids that are not identifiers (`f-nonstop`) are renamed for Express, which names components by id. */
export type Decompiled =
  | { express: string; renamed: number }
  | { error: string };
const decompiled = new Map<string, Decompiled>();

/** The surface in Express, decompiled on the server by Google's `@a2ui/agent` (POST /api/express). Cached per surface version. */
export function useDecompiled(opsJson: string | null): Decompiled | null {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!opsJson || decompiled.has(opsJson)) return;
    const ctl = new AbortController();
    const remember = (r: Decompiled) => {
      if (decompiled.size > 24)
        decompiled.delete(decompiled.keys().next().value!);
      decompiled.set(opsJson, r);
      rerender((n) => n + 1);
    };
    fetch("/api/express", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `{"ops":${opsJson}}`,
      signal: ctl.signal,
    })
      .then((res) => res.json())
      .then((j: { express?: unknown; renamed?: unknown; error?: unknown }) =>
        remember(
          typeof j.express === "string"
            ? { express: j.express, renamed: Number(j.renamed) || 0 }
            : {
                error: String(
                  j.error ?? "The server could not decompile this surface.",
                ),
              },
        ),
      )
      .catch((err: Error) => {
        if (err.name !== "AbortError")
          remember({
            error: "Could not reach the server to decompile this surface.",
          });
      });
    return () => ctl.abort();
  }, [opsJson]);
  return opsJson ? (decompiled.get(opsJson) ?? null) : null;
}

/** The selected surface as it would be sent, in Express or JSON, read-only, or (Edit) hand-edited with a live preview and no model. */
/** `jsonOnly`: the JSON alone, with no Express view (the workbench shows the Express in a tab of its own). */
export function JsonTab({
  wide,
  onWide,
  jsonOnly = false,
}: {
  wide: boolean;
  onWide: (wide: boolean) => void;
  jsonOnly?: boolean;
}) {
  const surface = useRunStore((s) =>
    s.selected ? s.surfaces[s.selected] : undefined,
  );
  const run = useRunStore((s) =>
    surface?.runId ? s.runs.find((r) => r.id === surface.runId) : undefined,
  );
  const [editing, setEditingState] = useState(() => editorMemory.editing);
  const [viewState, setViewState] = useState<View>(() => viewMemory.view);
  const view: View = jsonOnly ? "json" : viewState;
  const [copied, setCopied] = useState(false);
  const setEditing = (on: boolean) => {
    editorMemory.editing = on;
    setEditingState(on);
    if (!on) onWide(false);
  };
  const setView = (v: View) => {
    viewMemory.view = v;
    setViewState(v);
  };

  const sent = useMemo(
    () => (surface ? sendable(surface.ops, surface.surfaceId) : null),
    [surface],
  );
  const text = useMemo(
    () => (sent ? JSON.stringify(sent.ops, null, 2) : ""),
    [sent],
  );
  const written = writtenExpress(run);
  const writing = run?.status === "running";
  // Only decompile what the model did not write in Express, and only once the surface is complete.
  const decompile = useDecompiled(
    view === "express" && sent && !written && !writing
      ? JSON.stringify(sent.ops)
      : null,
  );

  if (editing)
    return (
      <JsonEditPane
        surface={surface}
        wide={wide}
        onWide={onWide}
        onExit={() => setEditing(false)}
      />
    );
  if (!surface || !sent) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-none items-center gap-2 border-b border-[var(--pg-line)] px-5 py-2.5">
          <EditToggle pressed={false} onClick={() => setEditing(true)} />
          <span className="truncate font-mono text-[11.5px] text-[var(--pg-faint)]">
            No surface yet
          </span>
        </div>
        <div className="p-5">
          <p className="text-[14px] text-muted-foreground">
            {jsonOnly
              ? "No surface yet. Build one, or click one in the chat, to see it as A2UI JSON."
              : "No surface yet. Click a surface in the chat to see it in A2UI Express and JSON."}
          </p>
          <p className="mt-2 text-[13px] text-[var(--pg-faint)]">
            Or skip the model: open a starter in the editor and change the JSON
            by hand. The preview re-renders as you type.
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={`${headerButton} mt-4`}
            data-json-start
          >
            <Pencil className="size-3" />
            Edit a starter
          </button>
        </div>
      </div>
    );
  }

  const express =
    written?.text ??
    (decompile && "express" in decompile ? decompile.express : null);
  const shown = view === "json" ? text : express;
  const note =
    view === "json"
      ? `The whole surface as one createSurface${sent.pending ? `. ${sent.pending} unfinished ${sent.pending === 1 ? "component is" : "components are"} left out` : ""}`
      : written
        ? `As the model wrote it${written.macros ? `. ${written.macros === 1 ? "Its macro expands" : "Its macros expand"} on the server` : ""}`
        : writing
          ? "Still building this surface"
          : `Decompiled from the JSON by Google's A2UI SDK${decompile && "renamed" in decompile && decompile.renamed ? `. ${decompile.renamed} ${decompile.renamed === 1 ? "id" : "ids"} renamed to valid Express names` : ""}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center justify-between gap-2 border-b border-[var(--pg-line)] px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <EditToggle pressed={false} onClick={() => setEditing(true)} />
          <span className="truncate font-mono text-[11.5px] text-muted-foreground">
            {sent.surfaceId}{" "}
            <span className="text-[var(--pg-faint)]">
              {sent.components} components
            </span>
          </span>
        </div>
        <div className="flex flex-none gap-1">
          <button
            type="button"
            disabled={!shown}
            onClick={() => {
              if (!shown) return;
              void navigator.clipboard?.writeText(shown);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className={headerButton}
          >
            {copied ? (
              <Check className="size-3" />
            ) : (
              <Copy className="size-3" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          {view === "json" ? (
            <a
              href={`data:application/json;charset=utf-8,${encodeURIComponent(text)}`}
              download={`${sent.surfaceId}.a2ui.json`}
              className={headerButton}
            >
              Export
            </a>
          ) : null}
        </div>
      </div>
      <div
        className={cn(
          "flex flex-none items-center gap-3 border-b border-[var(--pg-line)] px-5 py-2",
          jsonOnly && "py-2.5",
        )}
      >
        <div
          hidden={jsonOnly}
          role="radiogroup"
          aria-label="Show the surface as"
          className="flex flex-none items-center rounded-full border border-[var(--pg-line)] bg-[var(--pg-panel)] p-0.5"
        >
          {VIEWS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={view === id}
              onClick={() => setView(id)}
              data-json-view={id}
              className={cn(
                "rounded-full px-2.5 py-0.5 font-mono text-[11.5px] font-medium transition-colors",
                view === id
                  ? "bg-[var(--pg-raised)] text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <span
          className="min-w-0 text-[12px] leading-snug text-[var(--pg-faint)]"
          data-json-view-note
        >
          {note}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {view === "json" ? (
          <JsonView value={sent.ops} />
        ) : express ? (
          <ExpressView text={express} />
        ) : writing ? (
          <p className="text-[13px] text-muted-foreground">
            The Express shows here once this surface is complete.
          </p>
        ) : decompile && "error" in decompile ? (
          <p className="text-[13px] text-muted-foreground">
            This surface could not be written as Express: {decompile.error}
          </p>
        ) : (
          <p className="text-[13px] text-[var(--pg-faint)]">Decompiling…</p>
        )}
      </div>
    </div>
  );
}

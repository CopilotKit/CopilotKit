"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileJson, FileText, Search } from "lucide-react";
import type { SkillComponent } from "@/a2ui/export/skills";
import { CodeBlock } from "@/components/start/code-block";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { SkillPreset } from "./presets";

type Format = "express" | "json";
type File = { path: string; content: string };

const FORMATS: Array<{ id: Format; label: string; note: string }> = [
  { id: "express", label: "Express", note: "One line per component. The A2UI SDKs' default, about half the size of the same UI in JSON." },
  { id: "json", label: "JSON", note: "A2UI v1.0 messages written directly, with the full JSON Schema." },
];

const DEFAULT_NAME = "a2ui-playground";
const size = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
const PREVIEW_LIMIT = 60_000;
const groupLabel = (group: string) => (group === "Gen UI 2.0 standard" || group === "Macros" ? group : `Playground: ${group}`);

/**
 * The skill builder: pick the components and macros a skill covers (presets,
 * search, checkboxes), add a "when to use" note to any of them, and download
 * the skill the SDK generates for that pick, in Express or JSON.
 */
export function SkillBuilder({ components, presets }: { components: SkillComponent[]; presets: SkillPreset[] }) {
  const [format, setFormat] = useState<Format>("express");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(components.map((c) => c.name)));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [name, setName] = useState(DEFAULT_NAME);
  const [nameTouched, setNameTouched] = useState(false);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<File[]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [shown, setShown] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const noteRefs = useRef(new Map<string, HTMLInputElement | null>());

  const selection = useMemo(
    () => ({
      format,
      name,
      components: components.filter((c) => picked.has(c.name)).map((c) => c.name),
      notes: Object.fromEntries(Object.entries(notes).filter(([n, note]) => picked.has(n) && note.trim())),
    }),
    [components, format, name, notes, picked],
  );

  // The files for the current pick, regenerated a moment after it stops changing.
  useEffect(() => {
    if (!selection.components.length) {
      setFiles(undefined);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      fetch("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selection), signal: controller.signal })
        .then((r) => r.json())
        .then((d: { files?: File[]; error?: string }) => {
          setFiles(d.files);
          setError(d.error);
          setLoading(false);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selection]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = new Map<string, SkillComponent[]>();
    for (const c of components) {
      if (q && !c.name.toLowerCase().includes(q) && !c.description.toLowerCase().includes(q)) continue;
      out.set(c.group, [...(out.get(c.group) ?? []), c]);
    }
    return [...out.entries()];
  }, [components, query]);

  const activePreset = presets.find((p) => p.names.length === picked.size && p.names.every((n) => picked.has(n)))?.id;
  const skillDir = files?.find((f) => f.path.endsWith("/catalog.json"))?.path.split("/")[0] ?? DEFAULT_NAME;
  const zipName = `${skillDir}-skills-${format}.zip`;
  const file = files?.[shown] ?? files?.[0];
  const preview = useMemo(() => (file ? (file.content.length > PREVIEW_LIMIT ? `${file.content.slice(0, PREVIEW_LIMIT)}\n\n… (${size(file.content.length - PREVIEW_LIMIT)} more)` : file.content) : ""), [file]);

  const toggle = (names: string[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const n of names) (on ? next.add(n) : next.delete(n));
      return next;
    });

  const applyPreset = (p: SkillPreset) => {
    setPicked(new Set(p.names));
    if (!nameTouched) setName(p.id === "all" ? DEFAULT_NAME : `a2ui-${p.id}`);
  };

  const openNote = (n: string) => {
    setNotes((prev) => ({ ...prev, [n]: prev[n] ?? "" }));
    requestAnimationFrame(() => noteRefs.current.get(n)?.focus());
  };

  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...selection, download: true }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Download failed (${res.status}).`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? zipName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };

  const commands = `# put the skill where your agent reads skills
unzip -o ~/Downloads/${zipName} -d .claude

# in a clone of this repo: score each model using only the skill's components,
# then open /evals (add --out results.json to keep src/data/evals.json as it is)
GEMINI_API_KEY=... pnpm evals --skill ~/Downloads/${zipName}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight">Build a skill</h2>
        <p className="mt-2 max-w-[70ch] text-[15px] leading-relaxed text-muted-foreground">
          Pick the components and macros your agent should use, or start from a preset. Add a note to say when to use one. The preview is the skill you download.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1.5 sm:max-w-[280px]">
          <span className="text-[13px] text-muted-foreground">Skill name</span>
          <input
            data-skill-name
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            spellCheck={false}
            className="h-10 rounded-lg border border-border bg-white/[0.02] px-3 font-mono text-[14px] text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </label>
        <div role="radiogroup" aria-label="Skill format" className="flex items-center rounded-full border border-border bg-white/[0.02] p-0.5">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={format === f.id}
              data-skill-format={f.id}
              onClick={() => setFormat(f.id)}
              className={cn("rounded-full px-3.5 py-1.5 text-[14px] font-medium transition-colors", format === f.id ? "bg-white/[0.09] text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-skill-download
          onClick={download}
          disabled={!selection.components.length || downloading}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-[14px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Download className="size-4" /> {downloading ? "Preparing…" : "Download skill"}
        </button>
        <p className="w-full text-[14px] text-muted-foreground">{FORMATS.find((f) => f.id === format)!.note}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-[#0b0b0d]">
          <div className="flex flex-col gap-3 border-b border-border p-3">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Presets">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  data-skill-preset={p.id}
                  aria-pressed={activePreset === p.id}
                  onClick={() => applyPreset(p)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[13px] font-medium transition-colors",
                    activePreset === p.id ? "border-white/20 bg-white/[0.09] text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.label} <span className="font-mono text-[11.5px] text-muted-foreground">{p.names.length}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-white/[0.02] px-2.5 focus-within:border-ring">
                <Search className="size-3.5 flex-none text-muted-foreground" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search components"
                  aria-label="Search components"
                  className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
                />
              </label>
              <span data-skill-count className="flex-none font-mono text-[12.5px] tabular-nums text-muted-foreground">
                {picked.size} of {components.length}
              </span>
              <button
                type="button"
                data-skill-clear
                disabled={!picked.size}
                onClick={() => setPicked(new Set())}
                className="flex-none rounded-md px-2 py-0.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="max-h-[520px] min-h-[280px] overflow-y-auto overscroll-contain">
            {groups.map(([group, items]) => {
              const on = items.filter((c) => picked.has(c.name)).length;
              return (
                <section key={group} aria-label={groupLabel(group)}>
                  <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-[#0b0b0d] px-3 py-2">
                    <span className="text-[13px] font-medium">
                      {groupLabel(group)} <span className="font-mono text-[12px] text-muted-foreground">{on}/{items.length}</span>
                    </span>
                    <span className="flex items-center">
                      {(["All", "None"] as const).map((label) => (
                        <button
                          key={label}
                          type="button"
                          data-skill-group-toggle={label}
                          disabled={label === "All" ? on === items.length : on === 0}
                          onClick={() => toggle(items.map((c) => c.name), label === "All")}
                          aria-label={`${label === "All" ? "Pick all" : "Clear"} ${groupLabel(group)}`}
                          className="rounded-md px-2 py-0.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                        >
                          {label}
                        </button>
                      ))}
                    </span>
                  </div>
                  <ul className="py-1">
                    {items.map((c) => {
                      const checked = picked.has(c.name);
                      const id = `skill-c-${c.name}`;
                      const note = notes[c.name];
                      return (
                        <li key={c.name} className="px-3 py-1.5">
                          <div className="flex items-start gap-3">
                            <Checkbox id={id} data-skill-component={c.name} checked={checked} onCheckedChange={(v) => toggle([c.name], v === true)} className="mt-[3px]" />
                            <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                              <span className="font-mono text-[13px] text-foreground">{c.name}</span>
                              <span className="block truncate text-[12.5px] text-muted-foreground" title={c.description}>
                                {c.description}
                              </span>
                            </label>
                            {checked && note === undefined ? (
                              <button
                                type="button"
                                data-skill-add-note={c.name}
                                onClick={() => openNote(c.name)}
                                className="flex-none rounded-md px-2 py-0.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
                              >
                                Add note
                              </button>
                            ) : null}
                          </div>
                          {checked && note !== undefined ? (
                            <input
                              ref={(el) => {
                                noteRefs.current.set(c.name, el);
                              }}
                              data-skill-note={c.name}
                              value={note}
                              maxLength={400}
                              onChange={(e) => setNotes((prev) => ({ ...prev, [c.name]: e.target.value }))}
                              onBlur={() => {
                                if (note.trim()) return;
                                setNotes((prev) => {
                                  const next = { ...prev };
                                  delete next[c.name];
                                  return next;
                                });
                              }}
                              placeholder={`When should the agent use ${c.name}?`}
                              aria-label={`When to use ${c.name}`}
                              className="mt-1.5 ml-7 h-8 w-[calc(100%-1.75rem)] rounded-md border border-border bg-white/[0.02] px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring"
                            />
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
            {!groups.length ? <p className="px-3 py-6 text-[14px] text-muted-foreground">No component matches “{query}”.</p> : null}
          </div>
        </div>

        <div className="grid min-h-[480px] min-w-0 overflow-hidden rounded-xl border border-border bg-[#0b0b0d] grid-rows-[auto_minmax(0,1fr)]">
          <ul className="flex flex-col gap-0.5 border-b border-border p-2">
            <li className="flex items-center justify-between px-2.5 pb-1.5 pt-1 font-mono text-[12px] text-muted-foreground">
              <span>skills/</span>
              {loading ? <span>Generating…</span> : null}
            </li>
            {(files ?? []).map((f, i) => {
              const Icon = f.path.endsWith(".json") ? FileJson : FileText;
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    data-skill-file={f.path}
                    onClick={() => setShown(i)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left font-mono text-[13px] transition-colors",
                      file?.path === f.path ? "bg-white/[0.07] text-foreground" : "text-muted-foreground hover:bg-white/[0.035] hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5 flex-none" />
                    <span className="min-w-0 flex-1 truncate">{f.path}</span>
                    <span className="flex-none text-[11.5px] text-muted-foreground">{size(f.content.length)}</span>
                  </button>
                </li>
              );
            })}
            {!selection.components.length ? <li className="px-2.5 py-2 text-[13.5px] text-muted-foreground">Pick at least one component.</li> : null}
            {error ? <li className="px-2.5 py-2 text-[13.5px] text-red-300">{error}</li> : null}
          </ul>
          <pre data-skill-preview className="max-h-[560px] min-w-0 overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-[12.5px] leading-[1.7] text-foreground/85">
            {preview}
          </pre>
        </div>
      </div>

      <div className="grid gap-6 pt-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-4">
        <div>
          <h3 className="text-[18px] font-semibold tracking-tight">Use it, then evaluate it</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            Unzip the skill into your agent&apos;s skills folder. To see how well each model does with only these components, run the eval harness in a clone of this repo. It
            gives the composer only the skill&apos;s components (in JSON), runs the tasks in <code className="font-mono text-[0.9em] text-foreground">src/evals/tasks.ts</code>, and
            counts a surface that uses anything else as not valid.
          </p>
        </div>
        <CodeBlock code={commands} file="terminal" lang="sh" />
      </div>
    </div>
  );
}

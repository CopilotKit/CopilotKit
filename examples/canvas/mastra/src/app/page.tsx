"use client";

import { useCoAgent, useCopilotAction, useCoAgentStateRender, useCopilotAdditionalInstructions } from "@copilotkit/react-core";
import { CopilotKitCSSProperties, CopilotChat, CopilotPopup } from "@copilotkit/react-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { Button } from "@/components/ui/button"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import AppChatHeader, { PopupHeader } from "@/components/canvas/AppChatHeader";
import { X, Check, Loader2 } from "lucide-react"
import ShikiHighlighter from "react-shiki/web";
import { motion, useScroll, useTransform, useMotionValueEvent } from "motion/react";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import type { AgentState, PlanStep, Item, ItemData, ProjectData, EntityData, NoteData, ChartData, CardType } from "@/lib/canvas/types";
import { initialState, isNonEmptyAgentState } from "@/lib/canvas/state";
import { projectAddField4Item, projectSetField4ItemText, projectSetField4ItemDone, projectRemoveField4Item, chartAddField1Metric, chartSetField1Label, chartSetField1Value, chartRemoveField1Metric } from "@/lib/canvas/updates";
import useMediaQuery from "@/hooks/use-media-query";
import ItemHeader from "@/components/canvas/ItemHeader";
import NewItemMenu from "@/components/canvas/NewItemMenu";
import CardRenderer from "@/components/canvas/CardRenderer";

export default function CopilotKitPage() {
  const { state, setState } = useCoAgent<AgentState>({
    name: "sample_agent",
    initialState,
  });

  const cachedStateRef = useRef<AgentState>(state ?? initialState);
  useEffect(() => {
    if (isNonEmptyAgentState(state)) {
      cachedStateRef.current = state as AgentState;
    }
  }, [state]);
  const viewState: AgentState = isNonEmptyAgentState(state) ? (state as AgentState) : cachedStateRef.current;

  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [showJsonView, setShowJsonView] = useState<boolean>(false);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const { scrollY } = useScroll({ container: scrollAreaRef });
  const headerScrollThreshold = 64;
  const headerOpacity = useTransform(scrollY, [0, headerScrollThreshold], [1, 0]);
  const [headerDisabled, setHeaderDisabled] = useState<boolean>(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const descTextareaRef = useRef<HTMLInputElement | null>(null);
  const lastCreationRef = useRef<{ type: CardType; name: string; id: string; ts: number } | null>(null);
  const lastChecklistCreationRef = useRef<Record<string, { text: string; id: string; ts: number }>>({});
  const lastMetricCreationRef = useRef<Record<string, { label: string; value: number | ""; id: string; ts: number }>>({});
  const createdByTypeRef = useRef<Partial<Record<CardType, string>>>({});
  const prevPlanStatusRef = useRef<string | null>(null);

  useEffect(() => {
    const status = String(viewState?.planStatus ?? "");
    const prevStatus = prevPlanStatusRef.current;
    const started = status === "in_progress" && prevStatus !== "in_progress";
    const ended = prevStatus === "in_progress" && (status === "completed" || status === "failed" || status === "");
    if (started || ended) {
      createdByTypeRef.current = {};
    }
    prevPlanStatusRef.current = status;
  }, [viewState?.planStatus]);

  useMotionValueEvent(scrollY, "change", (y) => {
    const disable = y >= headerScrollThreshold;
    setHeaderDisabled(disable);
    if (disable) {
      titleInputRef.current?.blur();
      descTextareaRef.current?.blur();
    }
  });

  useEffect(() => {
    console.log("[CoAgent state updated]", state);
  }, [state]);

  useEffect(() => {
    const itemsCount = (viewState?.items ?? []).length;
    if (itemsCount === 0 && showJsonView) {
      setShowJsonView(false);
    }
  }, [viewState?.items, showJsonView]);

  const planStepsMemo = (viewState?.planSteps ?? initialState.planSteps) as PlanStep[];
  const planStatusMemo = viewState?.planStatus ?? initialState.planStatus;
  const currentStepIndexMemo = typeof viewState?.currentStepIndex === "number" ? viewState.currentStepIndex : initialState.currentStepIndex;

  useCoAgentStateRender<AgentState>({
    name: "sample_agent",
    nodeName: "plan-final-summary",
    render: ({ state }) => {
      const status = String(state?.planStatus ?? "");
      const steps = (state?.planSteps ?? []) as PlanStep[];
      if (!Array.isArray(steps) || steps.length === 0) return null;
      if (status !== "completed" && status !== "failed") return null;
      const count = steps.length;
      return (
        <div className="my-2 w-full">
          <Accordion type="single" collapsible defaultValue="done">
            <AccordionItem value="done">
              <AccordionTrigger className="text-xs">
                <span className="inline-flex items-center gap-2">
                  <Check className={cn("h-4 w-4", status === "completed" ? "text-green-600" : "text-red-600")} />
                  <span className="font-medium">{count} steps {status}</span>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="rounded-2xl border shadow-sm bg-card p-4">
                  <div className="mb-2 text-xs font-semibold">Plan <span className={cn("ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium border", status === "completed" ? "text-green-700 border-green-300 bg-green-50" : "text-red-700 border-red-300 bg-red-50")}>{status}</span></div>
                  <ol className="space-y-1">
                    {steps.map((s, i) => (
                      <li key={`${s.title ?? "step"}-${i}`} className="flex items-start gap-2">
                        <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center">
                          {String(s.status).toLowerCase() === "completed" ? (
                            <Check className="h-4 w-4 text-green-600" />
                          ) : String(s.status).toLowerCase() === "failed" ? (
                            <X className="h-4 w-4 text-red-600" />
                          ) : (
                            <span className="block h-2 w-2 rounded-full bg-gray-300" />
                          )}
                        </span>
                        <div className="flex-1 text-xs">
                          <div className={cn("leading-5", String(s.status).toLowerCase() === "completed" && "text-green-700", String(s.status).toLowerCase() === "failed" && "text-red-700")}>{s.title ?? `Step ${i + 1}`}</div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      );
    },
  });

  const getStatePreviewJSON = (s: AgentState | undefined): Record<string, unknown> => {
    const snapshot = (s ?? initialState) as AgentState;
    const { globalTitle, globalDescription, items } = snapshot;
    return {
      globalTitle: globalTitle ?? initialState.globalTitle,
      globalDescription: globalDescription ?? initialState.globalDescription,
      items: items ?? initialState.items,
    };
  };

  useCopilotAdditionalInstructions({
    instructions: (() => {
      const items = viewState.items ?? initialState.items;
      const gTitle = viewState.globalTitle ?? "";
      const gDesc = viewState.globalDescription ?? "";
      const summary = items
        .slice(0, 5)
        .map((p: Item) => `id=${p.id} • name=${p.name} • type=${p.type}`)
        .join("\n");
      const fieldSchema = [
        "FIELD SCHEMA (authoritative):",
        "- project.data:",
        "  - field1: string (text)",
        "  - field2: string (select: 'Option A' | 'Option B' | 'Option C'; empty string means unset)",
        "  - field3: string (date 'YYYY-MM-DD')",
        "  - field4: ChecklistItem[] where ChecklistItem={id: string, text: string, done: boolean, proposed: boolean}",
        "- entity.data:",
        "  - field1: string",
        "  - field2: string (select: 'Option A' | 'Option B' | 'Option C'; empty string means unset)",
        "  - field3: string[] (selected tags; subset of field3_options)",
        "  - field3_options: string[] (available tags)",
        "- note.data:",
        "  - field1: string (textarea)",
        "- chart.data:",
        "  - field1: Array<{id: string, label: string, value: number | ''}> with value in [0..100] or ''",
      ].join("\n");
      const toolUsageHints = [
        "TOOL USAGE HINTS:",
        "- Prefer calling specific actions: setProjectField1, setProjectField2, setProjectField3, addProjectChecklistItem, setProjectChecklistItem, removeProjectChecklistItem.",
        "- field2 values: 'Option A' | 'Option B' | 'Option C' | '' (empty clears).",
        "- field3 accepts natural dates (e.g., 'tomorrow', '2025-01-30'); it will be normalized to YYYY-MM-DD.",
        "- Checklist edits accept either the generated id (e.g., '001') or a numeric index (e.g., '1', 1-based).",
        "- For charts, values are clamped to [0..100]; use clearChartField1Value to clear an existing metric value.",
        "- Card subtitle/description keywords (description, overview, summary, caption, blurb) map to setItemSubtitleOrDescription. Never write these to data.field1 for non-note items.",
        "LOOP CONTROL: When asked to 'add a couple' items, add at most 2 and stop. Avoid repeated calls to the same mutating tool in one turn.",
        "RANDOMIZATION: If the user specifically asks for random/mock values, you MAY generate and set them right away using the tools (do not block for more details).",
        "VERIFICATION: After tools run, re-read the latest state and confirm what actually changed.",
      ].join("\n");
      return [
        "ALWAYS ANSWER FROM SHARED STATE (GROUND TRUTH).",
        "If a command does not specify which item to change, ask the user to clarify before proceeding.",
        `Global Title: ${gTitle || "(none)"}`,
        `Global Description: ${gDesc || "(none)"}`,
        "Items (sample):",
        summary || "(none)",
        fieldSchema,
        toolUsageHints,
      ].join("\n");
    })(),
  });

  const updateItem = useCallback(
    (itemId: string, updates: Partial<Item>) => {
      setState((prev) => {
        const base = prev ?? initialState;
        const items: Item[] = base.items ?? [];
        const nextItems = items.map((p) => (p.id === itemId ? { ...p, ...updates } : p));
        return { ...base, items: nextItems } as AgentState;
      });
    },
    [setState]
  );

  const updateItemData = useCallback(
    (itemId: string, updater: (prev: ItemData) => ItemData) => {
      setState((prev) => {
        const base = prev ?? initialState;
        const items: Item[] = base.items ?? [];
        const nextItems = items.map((p) => (p.id === itemId ? { ...p, data: updater(p.data) } : p));
        return { ...base, items: nextItems } as AgentState;
      });
    },
    [setState]
  );

  const deleteItem = useCallback((itemId: string) => {
    setState((prev) => {
      const base = prev ?? initialState;
      const existed = (base.items ?? []).some((p) => p.id === itemId);
      const items: Item[] = (base.items ?? []).filter((p) => p.id !== itemId);
      return { ...base, items, lastAction: existed ? `deleted:${itemId}` : `not_found:${itemId}` } as AgentState;
    });
  }, [setState]);

  const toggleTag = useCallback((itemId: string, tag: string) => {
    updateItemData(itemId, (prev) => {
      const anyPrev = prev as { field3?: string[] };
      if (Array.isArray(anyPrev.field3)) {
        const selected = new Set<string>(anyPrev.field3 ?? []);
        if (selected.has(tag)) selected.delete(tag); else selected.add(tag);
        return { ...anyPrev, field3: Array.from(selected) } as ItemData;
      }
      return prev;
    });
  }, [updateItemData]);

  const defaultDataFor = useCallback((type: CardType): ItemData => {
    switch (type) {
      case "project":
        return {
          field1: "",
          field2: "",
          field3: "",
          field4: [],
          field4_id: 0,
        } as ProjectData;
      case "entity":
        return {
          field1: "",
          field2: "",
          field3: [],
          field3_options: ["Tag 1", "Tag 2", "Tag 3"],
        } as EntityData;
      case "note":
        return { field1: "" } as NoteData;
      case "chart":
        return { field1: [], field1_id: 0 } as ChartData;
      default:
        return { content: "" } as NoteData;
    }
  }, []);

  const addItem = useCallback((type: CardType, name?: string) => {
    const t: CardType = type;
    let createdId = "";
    setState((prev) => {
      const base = prev ?? initialState;
      const items: Item[] = base.items ?? [];
      const maxExisting = items.reduce((max, it) => {
        const parsed = Number.parseInt(String(it.id ?? "0"), 10);
        return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
      }, 0);
      const priorCount = Number.isFinite(base.itemsCreated) ? (base.itemsCreated as number) : 0;
      const nextNumber = Math.max(priorCount, maxExisting) + 1;
      createdId = String(nextNumber).padStart(4, "0");
      const item: Item = {
        id: createdId,
        type: t,
        name: name && name.trim() ? name.trim() : "",
        subtitle: "",
        data: defaultDataFor(t),
      };
      const nextItems = [...items, item];
      const planActive = String(base?.planStatus ?? "") === "in_progress";
      let deduped = nextItems;
      if (planActive) {
        const seen = new Set<string>();
        deduped = [];
        for (const it of nextItems) {
          const key = it.type;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(it);
        }
      }
      return { ...base, items: deduped, itemsCreated: nextNumber, lastAction: `created:${createdId}` } as AgentState;
    });
    return createdId;
  }, [defaultDataFor, setState]);

  useCopilotAction({
    name: "setGlobalTitle",
    description: "Set the global title/name (outside of items).",
    available: "remote",
    parameters: [
      { name: "title", type: "string", required: true, description: "The new global title/name." },
    ],
    handler: ({ title }: { title: string }) => {
      setState((prev) => ({ ...(prev ?? initialState), globalTitle: title }));
    },
  });

  useCopilotAction({
    name: "setGlobalDescription",
    description: "Set the global description/subtitle (outside of items).",
    available: "remote",
    parameters: [
      { name: "description", type: "string", required: true, description: "The new global description/subtitle." },
    ],
    handler: ({ description }: { description: string }) => {
      setState((prev) => ({ ...(prev ?? initialState), globalDescription: description }));
    },
  });

  useCopilotAction({
    name: "setItemName",
    description: "Set an item's name/title.",
    available: "remote",
    parameters: [
      { name: "name", type: "string", required: true, description: "The new item name/title." },
      { name: "itemId", type: "string", required: true, description: "Target item id." },
    ],
    handler: ({ name, itemId }: { name: string; itemId: string }) => {
      updateItem(itemId, { name });
    },
  });

  useCopilotAction({
    name: "setItemSubtitleOrDescription",
    description: "Set an item's description/subtitle (short description or subtitle).",
    available: "remote",
    parameters: [
      { name: "subtitle", type: "string", required: true, description: "The new item description/subtitle." },
      { name: "itemId", type: "string", required: true, description: "Target item id." },
    ],
    handler: ({ subtitle, itemId }: { subtitle: string; itemId: string }) => {
      updateItem(itemId, { subtitle });
    },
  });

  useCopilotAction({
    name: "setNoteField1",
    description: "Update note content (note.data.field1).",
    available: "remote",
    parameters: [
      { name: "value", type: "string", required: true, description: "New content for note.data.field1." },
      { name: "itemId", type: "string", required: true, description: "Target item id (note)." },
    ],
    handler: ({ value, itemId }: { value: string; itemId: string }) => {
      updateItemData(itemId, (prev) => {
        const nd = prev as NoteData;
        if (Object.prototype.hasOwnProperty.call(nd, "field1")) {
          return { ...(nd as NoteData), field1: value } as NoteData;
        }
        return prev;
      });
    },
  });

  useCopilotAction({
    name: "appendNoteField1",
    description: "Append text to note content (note.data.field1).",
    available: "remote",
    parameters: [
      { name: "value", type: "string", required: true, description: "Text to append to note.data.field1." },
      { name: "itemId", type: "string", required: true, description: "Target item id (note)." },
      { name: "withNewline", type: "boolean", required: false, description: "If true, prefix with a newline." },
    ],
    handler: ({ value, itemId, withNewline }: { value: string; itemId: string; withNewline?: boolean }) => {
      updateItemData(itemId, (prev) => {
        const nd = prev as NoteData;
        if (Object.prototype.hasOwnProperty.call(nd, "field1")) {
          const existing = (nd.field1 ?? "");
          const next = existing + (withNewline ? "\n" : "") + value;
          return { ...(nd as NoteData), field1: next } as NoteData;
        }
        return prev;
      });
    },
  });

  useCopilotAction({
    name: "clearNoteField1",
    description: "Clear note content (note.data.field1).",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id (note)." },
    ],
    handler: ({ itemId }: { itemId: string }) => {
      updateItemData(itemId, (prev) => {
        const nd = prev as NoteData;
        if (Object.prototype.hasOwnProperty.call(nd, "field1")) {
          return { ...(nd as NoteData), field1: "" } as NoteData;
        }
        return prev;
      });
    },
  });

  useCopilotAction({
    name: "setProjectField1",
    description: "Update project field1 (text).",
    available: "remote",
    parameters: [
      { name: "value", type: "string", required: true, description: "New value for field1." },
      { name: "itemId", type: "string", required: true, description: "Target item id." },
    ],
    handler: ({ value, itemId }: { value: string; itemId: string }) => {
      const safeValue = String((value as unknown as string) ?? "");
      updateItemData(itemId, (prev) => {
        const anyPrev = prev as { field1?: string };
        if (typeof anyPrev.field1 === "string") {
          return { ...anyPrev, field1: safeValue } as ItemData;
        }
        return prev;
      });
    },
  });

  useCopilotAction({
    name: "setProjectField2",
    description: "Update project field2 (select).",
    available: "remote",
    parameters: [
      { name: "value", type: "string", required: true, description: "New value for field2." },
      { name: "itemId", type: "string", required: true, description: "Target item id." },
    ],
    handler: ({ value, itemId }: { value: string; itemId: string }) => {
      const safeValue = String((value as unknown as string) ?? "");
      updateItemData(itemId, (prev) => {
        const anyPrev = prev as { field2?: string };
        if (typeof anyPrev.field2 === "string") {
          return { ...anyPrev, field2: safeValue } as ItemData;
        }
        return prev;
      });
    },
  });

  useCopilotAction({
    name: "setProjectField3",
    description: "Update project field3 (date, YYYY-MM-DD).",
    available: "remote",
    parameters: [
      { name: "date", type: "string", required: true, description: "Date in YYYY-MM-DD format." },
      { name: "itemId", type: "string", required: true, description: "Target item id." },
    ],
    handler: (args: { date?: string; itemId: string } & Record<string, unknown>) => {
      const itemId = String(args.itemId);
      const dictArgs = args as Record<string, unknown>;
      const rawInput = (dictArgs["date"]) ?? (dictArgs["value"]) ?? (dictArgs["val"]) ?? (dictArgs["text"]);
      const normalizeDate = (input: unknown): string | null => {
        if (input == null) return null;
        if (input instanceof Date && !isNaN(input.getTime())) {
          const yyyy = input.getUTCFullYear();
          const mm = String(input.getUTCMonth() + 1).padStart(2, "0");
          const dd = String(input.getUTCDate()).padStart(2, "0");
          return `${yyyy}-${mm}-${dd}`;
        }
        const asString = String(input);
        if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) return asString;
        const parsed = new Date(asString);
        if (!isNaN(parsed.getTime())) {
          const yyyy = parsed.getUTCFullYear();
          const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
          const dd = String(parsed.getUTCDate()).padStart(2, "0");
          return `${yyyy}-${mm}-${dd}`;
        }
        return null;
      };
      const normalized = normalizeDate(rawInput);
      if (!normalized) return;
      updateItemData(itemId, (prev) => {
        const anyPrev = prev as { field3?: string };
        if (typeof anyPrev.field3 === "string") {
          return { ...anyPrev, field3: normalized } as ItemData;
        }
        return prev;
      });
    },
  });

  useCopilotAction({
    name: "clearProjectField3",
    description: "Clear project field3 (date).",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id." },
    ],
    handler: ({ itemId }: { itemId: string }) => {
      updateItemData(itemId, (prev) => {
        const anyPrev = prev as { field3?: string };
        if (typeof anyPrev.field3 === "string") {
          return { ...anyPrev, field3: "" } as ItemData;
        }
        return prev;
      });
    },
  });

  useCopilotAction({
    name: "addProjectChecklistItem",
    description: "Add a new checklist item to a project.",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id (project)." },
      { name: "text", type: "string", required: false, description: "Initial checklist text (optional)." },
    ],
    handler: ({ itemId, text }: { itemId: string; text?: string }) => {
      const norm = (text ?? "").trim();
      const project = (viewState.items ?? initialState.items).find((it) => it.id === itemId);
      if (project && project.type === "project") {
        const list = ((project.data as ProjectData).field4 ?? []);
        const dup = norm ? list.find((c) => (c.text ?? "").trim() === norm) : undefined;
        if (dup) return dup.id;
      }
      const now = Date.now();
      const key = `${itemId}`;
      const recent = lastChecklistCreationRef.current[key];
      if (recent && recent.text === norm && now - recent.ts < 800) {
        return recent.id;
      }
      let createdId = "";
      updateItemData(itemId, (prev) => {
        const { next, createdId: id } = projectAddField4Item(prev as ProjectData, text);
        createdId = id;
        return next;
      });
      lastChecklistCreationRef.current[key] = { text: norm, id: createdId, ts: now };
      return createdId;
    },
  });

  useCopilotAction({
    name: "setProjectChecklistItem",
    description: "Update a project's checklist item text and/or done state.",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id (project)." },
      { name: "checklistItemId", type: "string", required: true, description: "Checklist item id." },
      { name: "text", type: "string", required: false, description: "New text (optional)." },
      { name: "done", type: "boolean", required: false, description: "Done status (optional)." },
    ],
    handler: (args) => {
      const itemId = String(args.itemId ?? "");
      const target = args.checklistItemId ?? args.itemId;
      let targetId = target != null ? String(target) : "";
      const maybeDone = args.done;
      const text: string | undefined = args.text != null ? String(args.text) : undefined;
      const toBool = (v: unknown): boolean | undefined => {
        if (typeof v === "boolean") return v;
        if (typeof v === "string") {
          const s = v.trim().toLowerCase();
          if (s === "true") return true;
          if (s === "false") return false;
        }
        return undefined;
      };
      const done = toBool(maybeDone);
      updateItemData(itemId, (prev) => {
        let next = prev as ProjectData;
        const list = (next.field4 ?? []);
        if (!list.some((c) => c.id === targetId) && /^\d+$/.test(targetId)) {
          const n = parseInt(targetId, 10);
          let idx = -1;
          if (n >= 0 && n < list.length) idx = n;
          else if (n > 0 && n - 1 < list.length) idx = n - 1;
          if (idx >= 0) targetId = list[idx].id;
        }
        if (typeof text === "string") next = projectSetField4ItemText(next, targetId, text);
        if (typeof done === "boolean") next = projectSetField4ItemDone(next, targetId, done);
        return next;
      });
    },
  });

  useCopilotAction({
    name: "removeProjectChecklistItem",
    description: "Remove a checklist item from a project by id.",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id (project)." },
      { name: "checklistItemId", type: "string", required: true, description: "Checklist item id to remove." },
    ],
    handler: ({ itemId, checklistItemId }: { itemId: string; checklistItemId: string }) => {
      updateItemData(itemId, (prev) => projectRemoveField4Item(prev as ProjectData, checklistItemId));
    },
  });

  useCopilotAction({
    name: "setEntityField1",
    description: "Update entity field1 (text).",
    available: "remote",
    parameters: [
      { name: "value", type: "string", required: true, description: "New value for field1." },
      { name: "itemId", type: "string", required: true, description: "Target item id (entity)." },
    ],
    handler: ({ value, itemId }: { value: string; itemId: string }) => {
      updateItemData(itemId, (prev) => {
        const anyPrev = prev as EntityData;
        if (typeof anyPrev.field1 === "string") {
          return { ...anyPrev, field1: value } as ItemData;
        }
        return prev;
      });
    },
  });

  useCopilotAction({
    name: "setEntityField2",
    description: "Update entity field2 (select).",
    available: "remote",
    parameters: [
      { name: "value", type: "string", required: true, description: "New value for field2." },
      { name: "itemId", type: "string", required: true, description: "Target item id (entity)." },
    ],
    handler: ({ value, itemId }: { value: string; itemId: string }) => {
      updateItemData(itemId, (prev) => {
        const anyPrev = prev as { field2?: string };
        if (typeof anyPrev.field2 === "string") {
          return { ...anyPrev, field2: value } as ItemData;
        }
        return prev;
      });
    },
  });

  useCopilotAction({
    name: "addEntityField3",
    description: "Add a tag to entity field3 (tags) if not present.",
    available: "remote",
    parameters: [
      { name: "tag", type: "string", required: true, description: "Tag to add." },
      { name: "itemId", type: "string", required: true, description: "Target item id (entity)." },
    ],
    handler: ({ tag, itemId }: { tag: string; itemId: string }) => {
      updateItemData(itemId, (prev) => {
        const e = prev as EntityData;
        const current = new Set<string>((e.field3 ?? []) as string[]);
        current.add(tag);
        return { ...e, field3: Array.from(current) } as EntityData;
      });
    },
  });

  useCopilotAction({
    name: "removeEntityField3",
    description: "Remove a tag from entity field3 (tags) if present.",
    available: "remote",
    parameters: [
      { name: "tag", type: "string", required: true, description: "Tag to remove." },
      { name: "itemId", type: "string", required: true, description: "Target item id (entity)." },
    ],
    handler: ({ tag, itemId }: { tag: string; itemId: string }) => {
      updateItemData(itemId, (prev) => {
        const e = prev as EntityData;
        return { ...e, field3: ((e.field3 ?? []) as string[]).filter((t) => t !== tag) } as EntityData;
      });
    },
  });

  useCopilotAction({
    name: "addChartField1",
    description: "Add a new metric (field1 entries).",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id (chart)." },
      { name: "label", type: "string", required: false, description: "Metric label (optional)." },
      { name: "value", type: "number", required: false, description: "Metric value 0..100 (optional)." },
    ],
    handler: ({ itemId, label, value }: { itemId: string; label?: string; value?: number }) => {
      const normLabel = (label ?? "").trim();
      const item = (viewState.items ?? initialState.items).find((it) => it.id === itemId);
      if (item && item.type === "chart") {
        const list = ((item.data as ChartData).field1 ?? []);
        const dup = normLabel ? list.find((m) => (m.label ?? "").trim() === normLabel) : undefined;
        if (dup) return dup.id;
      }
      const now = Date.now();
      const key = `${itemId}`;
      const recent = lastMetricCreationRef.current[key];
      const valKey: number | "" = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : "";
      if (recent && recent.label === normLabel && recent.value === valKey && now - recent.ts < 800) {
        return recent.id;
      }
      let createdId = "";
      updateItemData(itemId, (prev) => {
        const { next, createdId: id } = chartAddField1Metric(prev as ChartData, label, value);
        createdId = id;
        return next;
      });
      lastMetricCreationRef.current[key] = { label: normLabel, value: valKey, id: createdId, ts: now };
      return createdId;
    },
  });

  useCopilotAction({
    name: "setChartField1Label",
    description: "Update chart field1 entry label by index.",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id (chart)." },
      { name: "index", type: "number", required: true, description: "Metric index (0-based)." },
      { name: "label", type: "string", required: true, description: "New metric label." },
    ],
    handler: ({ itemId, index, label }: { itemId: string; index: number; label: string }) => {
      updateItemData(itemId, (prev) => chartSetField1Label(prev as ChartData, index, label));
    },
  });

  useCopilotAction({
    name: "setChartField1Value",
    description: "Update chart field1 entry value by index (0..100).",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id (chart)." },
      { name: "index", type: "number", required: true, description: "Metric index (0-based)." },
      { name: "value", type: "number", required: true, description: "Metric value 0..100." },
    ],
    handler: ({ itemId, index, value }: { itemId: string; index: number; value: number }) => {
      updateItemData(itemId, (prev) => chartSetField1Value(prev as ChartData, index, value));
    },
  });

  useCopilotAction({
    name: "clearChartField1Value",
    description: "Clear chart field1 entry value by index (sets to empty).",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id (chart)." },
      { name: "index", type: "number", required: true, description: "Metric index (0-based)." },
    ],
    handler: ({ itemId, index }: { itemId: string; index: number }) => {
      updateItemData(itemId, (prev) => chartSetField1Value(prev as ChartData, index, ""));
    },
  });

  useCopilotAction({
    name: "removeChartField1",
    description: "Remove a chart field1 entry by index.",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id (chart)." },
      { name: "index", type: "number", required: true, description: "Metric index (0-based)." },
    ],
    handler: ({ itemId, index }: { itemId: string; index: number }) => {
      updateItemData(itemId, (prev) => chartRemoveField1Metric(prev as ChartData, index));
    },
  });

  useCopilotAction({
    name: "createItem",
    description: "Create a new item.",
    available: "remote",
    parameters: [
      { name: "type", type: "string", required: true, description: "One of: project, entity, note, chart." },
      { name: "name", type: "string", required: false, description: "Optional item name." },
    ],
    handler: ({ type, name }: { type: string; name?: string }) => {
      const t = (type as CardType);
      const normalized = (name ?? "").trim();
      const planStatus = String(viewState?.planStatus ?? "");

      if (planStatus === "in_progress") {
        const existingOfType = (viewState.items ?? initialState.items).find((it) => it.type === t);
        if (existingOfType) {
          createdByTypeRef.current[t] = existingOfType.id;
          return existingOfType.id;
        }
        const existingCreatedId = createdByTypeRef.current[t];
        if (existingCreatedId) {
          return existingCreatedId;
        }
      }
      if (normalized) {
        const existing = (viewState.items ?? initialState.items).find((it) => it.type === t && (it.name ?? "").trim() === normalized);
        if (existing) {
          return existing.id;
        }
      }
      const now = Date.now();
      const recent = lastCreationRef.current;
      if (recent && recent.type === t && (recent.name ?? "") === normalized && now - recent.ts < 5000) {
        return recent.id;
      }
      const id = addItem(t, name);
      lastCreationRef.current = { type: t, name: normalized, id, ts: now };
      if (planStatus === "in_progress") {
        createdByTypeRef.current[t] = id;
      }
      return id;
    },
  });

  useCopilotAction({
    name: "deleteItem",
    description: "Delete an item by id.",
    available: "remote",
    parameters: [
      { name: "itemId", type: "string", required: true, description: "Target item id." },
    ],
    handler: ({ itemId }: { itemId: string }) => {
      const existed = (viewState.items ?? initialState.items).some((p) => p.id === itemId);
      deleteItem(itemId);
      return existed ? `deleted:${itemId}` : `not_found:${itemId}`;
    },
  });

  const titleClasses = cn(
    "w-full outline-none rounded-md px-2 py-1",
    "bg-transparent placeholder:text-gray-400",
    "ring-1 ring-transparent transition-all ease-out",
    "hover:ring-border",
    "focus:ring-2 focus:ring-accent/50 focus:shadow-sm focus:bg-accent/10",
    "focus:shadow-accent focus:placeholder:text-accent/65 focus:text-accent",
  );

  return (
    <div
      style={{ "--copilot-kit-primary-color": "#2563eb" } as CopilotKitCSSProperties}
      className="h-screen flex flex-col"
    >
      <div className="flex flex-1 overflow-hidden">
        <aside className="-order-1 max-md:hidden flex flex-col min-w-80 w-[30vw] max-w-120 p-4 pr-0">
          <div className="h-full flex flex-col align-start w-full shadow-lg rounded-2xl border border-sidebar-border overflow-hidden">
            <AppChatHeader />
            {(() => {
              const steps = planStepsMemo;
              const count = steps.length;
              const status = String(planStatusMemo ?? "");
              if (!Array.isArray(steps) || count === 0 || status === "completed" || status === "failed" || status === "") return null;
              if (status === "completed") {
                return null;
              }
              return (
                <div className="p-4 py-3 border-b">
                  <div className="rounded-xl border bg-card p-3">
                    <div className="mb-1 text-xs font-semibold">Plan <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium border text-blue-700 border-blue-300 bg-blue-50">in_progress</span></div>
                    <ol className="space-y-1">
                      {steps.map((s, i) => {
                        const st = String(s?.status ?? "pending").toLowerCase();
                        const isActive = typeof currentStepIndexMemo === "number" && currentStepIndexMemo === i && st === "in_progress";
                        const isDone = st === "completed";
                        const isFailed = st === "failed";
                        return (
                          <li key={`${s.title ?? "step"}-${i}`} className="flex items-start gap-2">
                            <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center">
                              {isDone ? (
                                <Check className="h-4 w-4 text-green-600" />
                              ) : isActive ? (
                                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                              ) : isFailed ? (
                                <X className="h-4 w-4 text-red-600" />
                              ) : (
                                <span className="block h-2 w-2 rounded-full bg-gray-300" />
                              )}
                            </span>
                            <div className="flex-1 text-xs">
                              <div className={cn("leading-5", isDone && "text-green-700", isActive && "text-blue-700", isFailed && "text-red-700")}>{s.title ?? `Step ${i + 1}`}</div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
      </div>
    </div>
  );
            })()}
            {isDesktop && (
              <CopilotChat
                className="flex-1 overflow-auto w-full"
                labels={{
                  title: "Agent",
                  initial:
                    "👋 Share a brief or ask to extract fields. Changes will sync with the canvas in real time.",
                }}
                suggestions={[
                  { title: "Add a Project", message: "Create a new project." },
                  { title: "Add an Entity", message: "Create a new entity." },
                  { title: "Add a Note", message: "Create a new note." },
                  { title: "Add a Chart", message: "Create a new chart." },
                ]}
              />
            )}
          </div>
        </aside>
        <main className="relative flex flex-1 h-full">
          <div ref={scrollAreaRef} className="relative overflow-auto size-full px-4 sm:px-8 md:px-10 py-4">
            <div className={cn(
              "relative mx-auto max-w-7xl h-full min-h-8",
              (showJsonView || (viewState.items ?? []).length === 0) && "flex flex-col",
            )}>
              {!showJsonView && (
                <motion.div style={{ opacity: headerOpacity }} className="sticky top-0 mb-6">
                  <input
                    ref={titleInputRef}
                    disabled={headerDisabled}
                    value={viewState?.globalTitle ?? initialState.globalTitle}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setState((prev) => ({ ...(prev ?? initialState), globalTitle: e.target.value }))
                    }
                    placeholder="Canvas title..."
                    className={cn(titleClasses, "text-2xl font-semibold")}
                  />
                  <input
                    ref={descTextareaRef}
                    disabled={headerDisabled}
                    value={viewState?.globalDescription ?? initialState.globalDescription}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setState((prev) => ({ ...(prev ?? initialState), globalDescription: e.target.value }))
                    }
                    placeholder="Canvas description..."
                    className={cn(titleClasses, "mt-2 text-sm leading-6 resize-none overflow-hidden")}
                  />
                </motion.div>
              )}
              {(viewState.items ?? []).length === 0 ? (
                <EmptyState className="flex-1">
                  <div className="mx-auto max-w-lg text-center">
                    <h2 className="text-lg font-semibold text-foreground">Nothing here yet</h2>
                    <p className="mt-2 text-sm text-muted-foreground">Create your first item to get started.</p>
                    <div className="mt-6 flex justify-center">
                      <NewItemMenu onSelect={(t: CardType) => addItem(t)} align="center" className="md:h-10" />
        </div>
      </div>
                </EmptyState>
              ) : (
                <div className="flex-1 py-0 overflow-hidden">
                  {showJsonView ? (
                    <div className="pb-16 size-full">
                      <div className="rounded-2xl border shadow-sm bg-card size-full overflow-auto max-md:text-sm">
                        <ShikiHighlighter language="json" theme="github-light">
                          {JSON.stringify(getStatePreviewJSON(viewState), null, 2)}
                        </ShikiHighlighter>
          </div>
        </div>
                  ) : (
                    <div className="grid gap-6 lg:grid-cols-2 pb-20">
                      {(viewState.items ?? []).map((item) => (
                        <article key={item.id} className="relative rounded-2xl border p-5 shadow-sm transition-colors ease-out bg-card hover:border-accent/40 focus-within:border-accent/60">
                          <button
                            type="button"
                            aria-label="Delete card"
                            className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-card text-gray-400 hover:bg-accent/10 hover:text-accent transition-colors"
                            onClick={() => deleteItem(item.id)}
                          >
                            <X className="h-4 w-4" />
                          </button>
                          <ItemHeader
                            id={item.id}
                            name={item.name}
                            subtitle={item.subtitle}
                            description={""}
                            onNameChange={(v) => updateItem(item.id, { name: v })}
                            onSubtitleChange={(v) => updateItem(item.id, { subtitle: v })}
                          />
                          <div className="mt-6">
                            <CardRenderer item={item} onUpdateData={(updater) => updateItemData(item.id, updater)} onToggleTag={(tag) => toggleTag(item.id, tag)} />
          </div>
                        </article>
                      ))}
        </div>
                  )}
            </div>
              )}
            </div>
          </div>
          {(viewState.items ?? []).length > 0 ? (
            <div className={cn(
              "absolute left-1/2 -translate-x-1/2 bottom-4",
              "inline-flex rounded-lg shadow-lg bg-card",
              "[&_button]:bg-card [&_button]:w-22 md:[&_button]:h-10",
              "[&_button]:shadow-none! [&_button]:hover:bg-accent",
              "[&_button]:hover:border-accent [&_button]:hover:text-accent",
              "[&_button]:hover:bg-accent/10!",
            )}>
              <NewItemMenu
                onSelect={(t: CardType) => addItem(t)}
                align="center"
                className="rounded-r-none border-r-0 peer"
              />
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "gap-1.25 text-base font-semibold rounded-l-none",
                  "peer-hover:border-l-accent!",
                )}
                onClick={() => setShowJsonView((v) => !v)}
              >
                {showJsonView ? "Canvas" : <>JSON</>}
              </Button>
            </div>
          ) : null}
        </main>
        </div>
      <div className="md:hidden">
        {!isDesktop && (
          <CopilotPopup
            Header={PopupHeader}
            labels={{
              title: "Agent",
              initial:
                "👋 Share a brief or ask to extract fields. Changes will sync with the canvas in real time.",
            }}
            suggestions={[
              { title: "Add a Project", message: "Create a new project." },
              { title: "Add an Entity", message: "Create a new entity." },
              { title: "Add a Note", message: "Create a new note." },
              { title: "Add a Chart", message: "Create a new chart." },
            ]}
          />
        )}
      </div>
    </div>
  );
}

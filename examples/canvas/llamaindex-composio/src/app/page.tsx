"use client";

import { useCoAgent, useCopilotAction, useCopilotAdditionalInstructions } from "@copilotkit/react-core";
import { CopilotKitCSSProperties, CopilotChat, CopilotPopup } from "@copilotkit/react-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { Button } from "@/components/ui/button"
import AppChatHeader, { PopupHeader } from "@/components/canvas/AppChatHeader";
import { X } from "lucide-react"
import CardRenderer from "@/components/canvas/CardRenderer";
import ShikiHighlighter from "react-shiki/web";
import { motion, useScroll, useTransform, useMotionValueEvent } from "motion/react";
import { EmptyState } from "@/components/empty-state";
import { cn, getContentArg } from "@/lib/utils";
import type { AgentState, Item, ItemData, ProjectData, EntityData, NoteData, ChartData, CardType } from "@/lib/canvas/types";
import { initialState, isNonEmptyAgentState } from "@/lib/canvas/state";
import { projectAddField4Item, projectSetField4ItemText, projectSetField4ItemDone, projectRemoveField4Item, chartAddField1Metric, chartSetField1Label, chartSetField1Value, chartRemoveField1Metric } from "@/lib/canvas/updates";
import useMediaQuery from "@/hooks/use-media-query";
import ItemHeader from "@/components/canvas/ItemHeader";
import NewItemMenu from "@/components/canvas/NewItemMenu";

export default function CopilotKitPage() {
  const { state, setState } = useCoAgent<AgentState>({
    name: "sample_agent",
    initialState,
  });
  

  // Global cache for the last non-empty agent state
  const cachedStateRef = useRef<AgentState>(state ?? initialState);
  useEffect(() => {
    if (isNonEmptyAgentState(state)) {
      cachedStateRef.current = state as AgentState;
    }
  }, [state]);
  // we use viewState to avoid transient flicker; TODO: troubleshoot and remove this workaround
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
    
    // Auto-sync to Google Sheets if syncSheetId is present
    const autoSyncToSheets = async () => {
      console.log("[AUTO-SYNC] Checking sync conditions:", {
        hasState: !!state,
        syncSheetId: state?.syncSheetId,
        itemsLength: state?.items?.length || 0
      });
      
      if (!state || !state.syncSheetId) {
        console.log("[AUTO-SYNC] Skipping - no sheet configured");
        return; // No sync needed - no sheet configured
      }
      
      try {
        console.log(`[AUTO-SYNC] Syncing ${state.items?.length || 0} items to sheet: ${state.syncSheetId}`);
        
        const response = await fetch('/api/sheets/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            canvas_state: state,
            sheet_id: state.syncSheetId,
            sheet_name: state.syncSheetName,
          }),
        });

        if (response.ok) {
          const result = await response.json();
          console.log('[AUTO-SYNC] ✅ Successfully synced to Google Sheets:', result.message);
        } else {
          const error = await response.json();
          console.warn('[AUTO-SYNC] ❌ Failed to sync to Google Sheets:', error.error);
        }
      } catch (error) {
        console.warn('[AUTO-SYNC] ❌ Exception during auto-sync:', error);
      }
    };

    // Debounce the sync to avoid too many requests
    const timeoutId = setTimeout(autoSyncToSheets, 1000);
    return () => clearTimeout(timeoutId);
  }, [state]);

  // Reset JSON view when there are no items
  useEffect(() => {
    const itemsCount = (viewState?.items ?? []).length;
    if (itemsCount === 0 && showJsonView) {
      setShowJsonView(false);
    }
  }, [viewState?.items, showJsonView]);



  const getStatePreviewJSON = (s: AgentState | undefined): Record<string, unknown> => {
    const snapshot = (s ?? initialState) as AgentState;
    const { globalTitle, globalDescription, items } = snapshot;
    return {
      globalTitle: globalTitle ?? initialState.globalTitle,
      globalDescription: globalDescription ?? initialState.globalDescription,
      items: items ?? initialState.items,
    };
  };


  // Strengthen grounding: always prefer shared state over chat history
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
        "- To create cards, call createItem with { type: 'project' | 'entity' | 'note' | 'chart', name?: string } and use returned id.",
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

  // Tool-based HITL: choose item
  useCopilotAction({
    name: "choose_item",
    description: "Ask the user to choose an item id from the canvas.",
    available: "remote",
    parameters: [
      { name: "content", type: "string", required: false, description: "Prompt to display." },
    ],
    renderAndWaitForResponse: ({ respond, args }) => {
      const items = viewState.items ?? initialState.items;
      if (!items.length) {
        return (
          <div className="rounded-md border bg-white p-4 text-sm shadow">
            <p>No items available.</p>
          </div>
        );
      }
      let selectedId = items[0].id;
      return (
        <div className="rounded-md border bg-white p-4 text-sm shadow">
          <p className="mb-2 font-medium">Select an item</p>
          <p className="mb-3 text-xs text-gray-600">{getContentArg(args) ?? "Which item should I use?"}</p>
          <select
            className="w-full rounded border px-2 py-1"
            defaultValue={selectedId}
            onChange={(e) => {
              selectedId = e.target.value;
            }}
          >
            {(items).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.id})
              </option>
            ))}
          </select>
          <div className="mt-3 flex justify-end gap-2">
            <button className="rounded border px-3 py-1" onClick={() => respond?.("")}>Cancel</button>
            <button className="rounded border bg-blue-600 px-3 py-1 text-white" onClick={() => respond?.(selectedId)}>Use item</button>
          </div>
        </div>
      );
    },
  });

  // Tool-based HITL: choose card type
  useCopilotAction({
    name: "choose_card_type",
    description: "Ask the user to choose a card type to create.",
    available: "remote",
    parameters: [
      { name: "content", type: "string", required: false, description: "Prompt to display." },
    ],
    renderAndWaitForResponse: ({ respond, args }) => {
      const options: { id: CardType; label: string }[] = [
        { id: "project", label: "Project" },
        { id: "entity", label: "Entity" },
        { id: "note", label: "Note" },
        { id: "chart", label: "Chart" },
      ];
      let selected: CardType | "" = "";
      return (
        <div className="rounded-md border bg-white p-4 text-sm shadow">
          <p className="mb-2 font-medium">Select a card type</p>
          <p className="mb-3 text-xs text-gray-600">{getContentArg(args) ?? "Which type of card should I create?"}</p>
          <select
            className="w-full rounded border px-2 py-1"
            defaultValue=""
            onChange={(e) => {
              selected = e.target.value as CardType;
            }}
          >
            <option value="" disabled>Select an item type…</option>
            {options.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
          <div className="mt-3 flex justify-end gap-2">
            <button className="rounded border px-3 py-1" onClick={() => respond?.("")}>Cancel</button>
            <button
              className="rounded border bg-blue-600 px-3 py-1 text-white"
              onClick={() => selected && respond?.(selected)}
              disabled={!selected}
            >
              Use type
            </button>
          </div>
        </div>
      );
    },
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

  // Checklist item local helper removed; Copilot actions handle checklist CRUD

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

  // Remove checklist item local helper removed; use Copilot action instead

  // Helper to generate default data by type
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
      // Derive next numeric id robustly from both itemsCreated counter and max existing id
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
      return { ...base, items: nextItems, itemsCreated: nextNumber, lastAction: `created:${createdId}` } as AgentState;
    });
    return createdId;
  }, [defaultDataFor, setState]);



  // Frontend Actions (exposed as tools to the agent via CopilotKit)
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

  // Frontend Actions (item-scoped)
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

  // Set item subtitle
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


  // Note-specific field updates (field numbering)
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

  // Project-specific field updates
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
        // Already in YYYY-MM-DD
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

  // Clear project field3 (date)
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

  // Project field4 (checklist) CRUD
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
      // 1) If a checklist item with same text exists, return its id
      const project = (viewState.items ?? initialState.items).find((it) => it.id === itemId);
      if (project && project.type === "project") {
        const list = ((project.data as ProjectData).field4 ?? []);
        const dup = norm ? list.find((c) => (c.text ?? "").trim() === norm) : undefined;
        if (dup) return dup.id;
      }
      // 2) Per-project throttle to avoid rapid duplicates
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
        // If a plain numeric was provided, allow using it as index (0- or 1-based)
        if (!list.some((c) => c.id === targetId) && /^\d+$/.test(targetId)) {
          const n = parseInt(targetId, 10);
          let idx = -1;
          if (n >= 0 && n < list.length) idx = n; // 0-based
          else if (n > 0 && n - 1 < list.length) idx = n - 1; // 1-based
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

  // Entity field updates and field3 (tags)
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
        const anyPrev = prev;
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

  // Chart field1 (metrics) CRUD
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
      // 1) If a metric with same label exists, return its id
      const item = (viewState.items ?? initialState.items).find((it) => it.id === itemId);
      if (item && item.type === "chart") {
        const list = ((item.data as ChartData).field1 ?? []);
        const dup = normLabel ? list.find((m) => (m.label ?? "").trim() === normLabel) : undefined;
        if (dup) return dup.id;
      }
      // 2) Per-chart throttle to avoid rapid duplicates
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

  // Clear chart metric value by index
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

      // 1) Name-based idempotency: if an item with same type+name exists, return it
      if (normalized) {
        const existing = (viewState.items ?? initialState.items).find((it) => it.type === t && (it.name ?? "").trim() === normalized);
        if (existing) {
          return existing.id;
        }
      }
      // 2) Per-run throttle: avoid duplicate creations within a short window for identical type+name
      const now = Date.now();
      const recent = lastCreationRef.current;
      if (recent && recent.type === t && (recent.name ?? "") === normalized && now - recent.ts < 5000) {
        return recent.id;
      }
      const id = addItem(t, name);
      lastCreationRef.current = { type: t, name: normalized, id, ts: now };
      return id;
    },
  });

  // Frontend action: delete an item by id
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

  // Google Sheets Integration Actions
  const [showSheetModal, setShowSheetModal] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importError, setImportError] = useState<string>("");
  const [availableSheets, setAvailableSheets] = useState<string[]>([]);
  const [selectedSheetName, setSelectedSheetName] = useState<string>("");
  const [isCreatingSheet, setIsCreatingSheet] = useState<boolean>(false);
  const [newSheetTitle, setNewSheetTitle] = useState<string>("");
  const [showFormatWarning, setShowFormatWarning] = useState<boolean>(false);
  const [formatWarningDetails, setFormatWarningDetails] = useState<{
    sheetId: string;
    sheetName?: string;
    existingFormat: string;
    canvasFormat: string;
  } | null>(null);

  const fetchAvailableSheets = async (sheetId: string) => {
    try {
      // Extract sheet ID from URL if needed
      let cleanSheetId = sheetId.trim();
      if (cleanSheetId.includes("/spreadsheets/d/")) {
        const start = cleanSheetId.indexOf("/spreadsheets/d/") + "/spreadsheets/d/".length;
        const end = cleanSheetId.indexOf("/", start);
        cleanSheetId = cleanSheetId.substring(start, end === -1 ? undefined : end);
      }

      setImportError("");
      
      // Make API call to list available sheets
      const response = await fetch('/api/sheets/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sheet_id: cleanSheetId }),
      });

      if (response.ok) {
        const result = await response.json();
        const sheetNames = result.sheet_names || [];
        setAvailableSheets(sheetNames);
        if (sheetNames.length > 0) {
          setSelectedSheetName(""); // Default to first sheet
        }
      } else {
        const error = await response.json();
        setImportError(`Failed to list sheets: ${error.error}`);
      }
      
    } catch (error) {
      console.error('Error fetching sheets:', error);
      setImportError("Failed to fetch available sheets");
    }
  };

  const importFromSheet = async (sheetId: string, sheetName?: string, forceImport = false) => {
    if (!sheetId.trim()) {
      setImportError("Please enter a valid Sheet ID");
      return;
    }

    setIsImporting(true);
    setImportError("");

    try {
      // Extract sheet ID from URL if needed
      let cleanSheetId = sheetId.trim();
      if (cleanSheetId.includes("/spreadsheets/d/")) {
        const start = cleanSheetId.indexOf("/spreadsheets/d/") + "/spreadsheets/d/".length;
        const end = cleanSheetId.indexOf("/", start);
        cleanSheetId = cleanSheetId.substring(start, end === -1 ? undefined : end);
      }

      // Check for format compatibility if we have existing canvas data and not forcing import
      if (!forceImport && viewState.items && viewState.items.length > 0) {
        // Get a preview of what the sheet contains
        try {
          const previewResponse = await fetch('/api/sheets/import', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
              sheet_id: cleanSheetId,
              sheet_name: sheetName || selectedSheetName || undefined,
              preview_only: true
            }),
          });

          if (previewResponse.ok) {
            const previewResult = await previewResponse.json();
            
            // Check if the sheet has a different format than canvas
            const hasCanvasFormat = viewState.items.some(item => 
              item.type && ['project', 'entity', 'note', 'chart'].includes(item.type)
            );
            
            const sheetHasData = previewResult.data && previewResult.data.items && previewResult.data.items.length > 0;
            
            if (hasCanvasFormat && sheetHasData) {
              // Show format warning
              setFormatWarningDetails({
                sheetId: cleanSheetId,
                sheetName: sheetName || selectedSheetName || undefined,
                existingFormat: `${previewResult.data.items.length} items detected in sheet`,
                canvasFormat: `${viewState.items.length} items currently in canvas`
              });
              setShowFormatWarning(true);
              setIsImporting(false);
              return;
            }
          }
        } catch (previewError) {
          console.warn("Could not preview sheet format:", previewError);
          // Continue with normal import if preview fails
        }
      }

      // Make direct API call to backend for importing
      const response = await fetch('/api/sheets/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          sheet_id: cleanSheetId,
          sheet_name: sheetName || selectedSheetName || undefined
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || 'Failed to import sheet');
      }

      const result = await response.json();
      
      if (result.success && result.data) {
        // Update the canvas state with imported data
        console.log("Import result data:", result.data);
        setState(result.data);
        setShowSheetModal(false);
        setImportError("");
        console.log("Successfully imported sheet data:", result.message);
      } else {
        throw new Error(result.message || 'Failed to process sheet data');
      }
      
    } catch (error) {
      console.error('Import error:', error);
      setImportError(error instanceof Error ? error.message : 'Failed to import sheet');
    } finally {
      setIsImporting(false);
    }
  };

  const createNewSheet = async (title: string) => {
    if (!title.trim()) {
      setImportError("Please enter a valid sheet title");
      return;
    }

    setIsCreatingSheet(true);
    setImportError("");

    try {
      const response = await fetch('/api/sheets/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: title.trim() }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || 'Failed to create sheet');
      }

      const result = await response.json();
      console.log("Create sheet result:", result);
      
      if (result.success) {
        const sheetId = result.sheet_id;
        const sheetUrl = result.sheet_url;
        
        if (!sheetId) {
          console.warn("Sheet creation succeeded but no sheet_id returned");
          setImportError("Sheet was created but ID not returned. Check your Google Drive.");
          return;
        }
        
        // If we have existing items, sync them to the new sheet first, then set up for bi-directional sync
        if (viewState.items && viewState.items.length > 0) {
          try {
            const syncResponse = await fetch('/api/sheets/sync', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                canvas_state: viewState,
                sheet_id: sheetId,
              }),
            });

            if (syncResponse.ok) {
              console.log("Successfully synced existing items to new sheet");
              // Set the newly created sheet as the sync target and update title/description
              setState((prev) => ({
                ...prev,
                items: prev?.items || [],
                itemsCreated: prev?.itemsCreated || 0,
                globalTitle: result.title || title.trim(),
                globalDescription: `Connected to Google Sheet: ${result.title || title.trim()}`,
                syncSheetId: sheetId,
                syncSheetName: "Sheet1"
              }));
            } else {
              console.warn("Failed to sync existing items to new sheet");
            }
          } catch (syncError) {
            console.warn("Failed to sync existing items to new sheet:", syncError);
          }
        } else {
          // No existing items - import the empty sheet structure into canvas
          try {
            const importResponse = await fetch('/api/sheets/import', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ 
                sheet_id: sheetId,
                sheet_name: "Sheet1"
              }),
            });

            if (importResponse.ok) {
              const importResult = await importResponse.json();
              if (importResult.success && importResult.data) {
                // Update canvas state with the imported (likely empty) structure and set title/description
                setState({
                  ...importResult.data,
                  globalTitle: result.title || title.trim(),
                  globalDescription: `Connected to Google Sheet: ${result.title || title.trim()}`,
                  syncSheetId: sheetId,
                  syncSheetName: "Sheet1"
                });
                console.log("Successfully imported new sheet structure into canvas");
              }
            }
          } catch (importError) {
            console.warn("Failed to import new sheet structure:", importError);
            // Fallback: just set sync info and update title/description
            setState((prev) => ({ 
              ...initialState,
              ...prev,
              globalTitle: result.title || title.trim(),
              globalDescription: `Connected to Google Sheet: ${result.title || title.trim()}`,
              syncSheetId: sheetId,
              syncSheetName: "Sheet1"
            }));
          }
        }
        
        setShowSheetModal(false);
        setImportError("");
        console.log("Successfully created new sheet:", result.message);
        
        // Show success message or provide link
        if (sheetUrl) {
          window.open(sheetUrl, '_blank');
        }
        
      } else {
        throw new Error('Failed to create sheet: ' + (result.error || result.message || 'Unknown error'));
      }
      
    } catch (error) {
      console.error('Create sheet error:', error);
      setImportError(error instanceof Error ? error.message : 'Failed to create sheet');
    } finally {
      setIsCreatingSheet(false);
    }
  };

  useCopilotAction({
    name: "openSheetSelectionModal",
    description: "Open modal for selecting Google Sheets.",
    available: "remote",
    parameters: [],
    handler: () => {
      setShowSheetModal(true);
      return "sheet_modal_opened";
    },
  });

  useCopilotAction({
    name: "setSyncSheetId",
    description: "Set the Google Sheet ID for auto-sync.",
    available: "remote",
    parameters: [
      { name: "sheetId", type: "string", required: true, description: "The Google Sheet ID to sync with." },
    ],
    handler: ({ sheetId }: { sheetId: string }) => {
      setState((prev) => ({ 
        ...initialState, 
        ...prev, 
        syncSheetId: sheetId 
      }));
      return `sync_sheet_set:${sheetId}`;
    },
  });

  useCopilotAction({
    name: "searchUserSheets",
    description: "Search user's Google Sheets and display them for selection.",
    available: "remote",
    parameters: [],
    handler: () => {
      // This will be handled by the agent using GOOGLESHEETS_SEARCH_SPREADSHEETS
      return "searching_sheets";
    },
  });

  useCopilotAction({
    name: "syncCanvasToSheets",
    description: "Manually sync current canvas state to Google Sheets.",
    available: "remote",
    parameters: [],
    handler: async () => {
      if (!viewState.syncSheetId) {
        return "No sync sheet ID configured. Please set a sheet ID first.";
      }
      
      if (!viewState.items || viewState.items.length === 0) {
        return "No items to sync. Canvas is empty.";
      }

      try {
        console.log(`[MANUAL-SYNC] Syncing ${viewState.items.length} items to sheet: ${viewState.syncSheetId}`);
        
        const response = await fetch('/api/sheets/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            canvas_state: viewState,
            sheet_id: viewState.syncSheetId,
          }),
        });

        if (response.ok) {
          const result = await response.json();
          return `✅ Successfully synced ${viewState.items.length} items to Google Sheets: ${result.message}`;
        } else {
          const error = await response.json();
          return `❌ Failed to sync to Google Sheets: ${error.error}`;
        }
      } catch (error) {
        return `❌ Exception during manual sync: ${error}`;
      }
    },
  });

  useCopilotAction({
    name: "forceCanvasToSheetsSync",
    description: "Force sync current canvas state to a specific Google Sheet, even if syncSheetId is not set.",
    available: "remote",
    parameters: [
      { name: "sheetId", type: "string", required: true, description: "Google Sheet ID to sync to." },
    ],
    handler: async ({ sheetId }: { sheetId: string }) => {
      if (!viewState.items || viewState.items.length === 0) {
        return "No items to sync. Canvas is empty.";
      }

      try {
        console.log(`[FORCE-SYNC] Syncing ${viewState.items.length} items to sheet: ${sheetId}`);
        
        const response = await fetch('/api/sheets/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            canvas_state: viewState,
            sheet_id: sheetId,
          }),
        });

        if (response.ok) {
          const result = await response.json();
          return `✅ Successfully force-synced ${viewState.items.length} items to Google Sheets: ${result.message}`;
        } else {
          const error = await response.json();
          return `❌ Failed to force-sync to Google Sheets: ${error.error}`;
        }
      } catch (error) {
        return `❌ Exception during force-sync: ${error}`;
      }
    },
  });

  const titleClasses = cn(
    /* base styles */
    "w-full outline-none rounded-md px-2 py-1",
    "bg-transparent placeholder:text-gray-400",
    "ring-1 ring-transparent transition-all ease-out",
    /* hover styles */
    "hover:ring-border",
    /* focus styles */
    "focus:ring-2 focus:ring-accent/50 focus:shadow-sm focus:bg-accent/10",
    "focus:shadow-accent focus:placeholder:text-accent/65 focus:text-accent",
  );

  const sheetModalInputClasses = cn(
    "w-full rounded-xl border border-border/80 bg-background px-3.5 py-2.5 text-sm text-foreground shadow-xs transition-all",
    "placeholder:text-muted-foreground/70 focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-60"
  );

  const handleCloseSheetsModal = useCallback(() => {
    if (isImporting || isCreatingSheet) {
      return;
    }
    setShowSheetModal(false);
    setImportError("");
    setAvailableSheets([]);
    setSelectedSheetName("");
    setNewSheetTitle("");
  }, [
    isCreatingSheet,
    isImporting,
    setAvailableSheets,
    setImportError,
    setNewSheetTitle,
    setSelectedSheetName,
    setShowSheetModal,
  ]);

  const [sheetId, setSheetId] = useState<string>('')

  return (
    <div
      style={{ "--copilot-kit-primary-color": "#2563eb" } as CopilotKitCSSProperties}
      className="h-screen flex flex-col"
    >
      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat Sidebar */}
        <aside className="-order-1 max-md:hidden flex flex-col min-w-80 w-[30vw] max-w-120 p-4 pr-0">
          <div className="h-full flex flex-col align-start w-full shadow-lg rounded-2xl border border-sidebar-border overflow-hidden">
            {/* Chat Header */}
            <AppChatHeader />
            {/* Chat Content - conditionally rendered to avoid duplicate rendering */}
            {isDesktop && (
              <CopilotChat
                className="flex-1 overflow-auto w-full"
                labels={{
                  title: "Agent",
                  initial:
                    "👋 Share a brief or ask to extract fields. Changes will sync with the canvas in real time.",
                }}
                suggestions={[
                  {
                    title: "Add a Project",
                    message: "Create a new project.",
                  },
                  {
                    title: "Add an Entity",
                    message: "Create a new entity.",
                  },
                  {
                    title: "Add a Note",
                    message: "Create a new note.",
                  },
                  {
                    title: "Add a Chart",
                    message: "Create a new chart.",
                  },
                ]}
              />
            )}
          </div>
        </aside>
        {/* Main Content */}
        <main className="relative flex flex-1 h-full">
          <div ref={scrollAreaRef} className="relative overflow-auto size-full px-4 sm:px-8 md:px-10 py-4">
            <div className={cn(
              "relative mx-auto max-w-7xl h-full min-h-8",
              (showJsonView || (viewState.items ?? []).length === 0) && "flex flex-col",
            )}>
              {/* Global Title & Description (hidden in JSON view) */}
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
                  "gap-1.25 text-base font-semibold rounded-none border-r-0",
                  "peer-hover:border-l-accent!",
                )}
                onClick={() => {
                  setShowSheetModal(true);
                }}
              >
                📊 Sheets
              </Button>
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "gap-1.25 text-base font-semibold rounded-l-none",
                )}
                onClick={() => setShowJsonView((v) => !v)}
              >
                {showJsonView
                  ? "Canvas"
                  : <>JSON</>
                }
              </Button>
            </div>
          ) : null}
        </main>
      </div>
      <div className="md:hidden">
        {/* Mobile Chat Popup - conditionally rendered to avoid duplicate rendering */}
        {!isDesktop && (
          <CopilotPopup
            Header={PopupHeader}
            labels={{
              title: "Agent",
              initial:
                "👋 Share a brief or ask to extract fields. Changes will sync with the canvas in real time.",
            }}
            suggestions={[
              {
                title: "Add a Project",
                message: "Create a new project.",
              },
              {
                title: "Add an Entity",
                message: "Create a new entity.",
              },
              {
                title: "Add a Note",
                message: "Create a new note.",
              },
              {
                title: "Add a Chart",
                message: "Create a new chart.",
              },
            ]}
          />
        )}
      </div>

      {/* Google Sheets Selection Modal */}
      {showSheetModal && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/75 px-4 py-10 backdrop-blur-sm sm:px-6"
          onClick={handleCloseSheetsModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="sheets-modal-title"
        >
          <div
            className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-border bg-card shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border/80 bg-muted px-6 py-5 sm:px-8">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Connections</p>
                <h2 id="sheets-modal-title" className="mt-1 text-lg font-semibold">Google Sheets</h2>
                <p className="text-sm text-muted-foreground">Sync the canvas with a Sheet—create a new one or import an existing source.</p>
              </div>
              <button
                onClick={handleCloseSheetsModal}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                disabled={isImporting || isCreatingSheet}
                aria-label="Close sheets modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 pb-6 sm:px-8 sm:pb-8">
              <div className="mt-6 space-y-6">
                <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/60 px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-sm font-medium text-foreground">Create a fresh Sheet</label>
                    <span className="text-xs font-medium text-muted-foreground/80">Sync starts immediately</span>
                  </div>
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="E.g. Product Roadmap"
                      className={sheetModalInputClasses}
                      value={newSheetTitle}
                      onChange={(e) => setNewSheetTitle(e.target.value)}
                      disabled={isImporting || isCreatingSheet}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newSheetTitle.trim()) {
                          createNewSheet(newSheetTitle);
                        }
                      }}
                    />
                    <Button
                      onClick={() => {
                        if (newSheetTitle.trim()) {
                          createNewSheet(newSheetTitle);
                        }
                      }}
                      className="w-full"
                      variant="secondary"
                      disabled={isImporting || isCreatingSheet || !newSheetTitle.trim()}
                    >
                      {isCreatingSheet ? "Creating…" : "Create & Connect"}
                    </Button>
                  </div>
                </div>

                <div className="space-y-4 rounded-2xl border border-dashed border-border/70 bg-card px-5 py-5">
                  <div className="text-sm text-foreground">
                    <span className="font-medium">Import an existing Sheet</span>
                    <p className="mt-1 text-xs text-muted-foreground">Paste a Sheet link or ID. We’ll hydrate the canvas and keep the connection live.</p>
                  </div>

                  {importError && (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      {importError}
                    </div>
                  )}

                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="Sheet ID or https://docs.google.com/spreadsheets/d/..."
                      className={sheetModalInputClasses}
                      id="sheet-id-input"
                      disabled={isImporting || isCreatingSheet}
                      value={sheetId}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSheetId(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const input = e.target as HTMLInputElement;
                          importFromSheet(input.value);
                        }
                      }}
                    />

                    <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                      <Button
                        onClick={() => {
                          const input = document.getElementById("sheet-id-input") as HTMLInputElement;
                          if (input?.value) {
                            fetchAvailableSheets(input.value);
                          }
                        }}
                        variant="outline"
                        className="flex-1"
                        disabled={isImporting || isCreatingSheet || !sheetId}
                      >
                        List worksheets
                      </Button>
                      <Button
                        onClick={() => {
                          const input = document.getElementById("sheet-id-input") as HTMLInputElement;
                          if (input) {
                            importFromSheet(input.value);
                          }
                        }}
                        className="flex-1"
                        variant="secondary"
                        disabled={isImporting || isCreatingSheet || !availableSheets.length}
                      >
                        {isImporting ? "Importing…" : "Import to Canvas"}
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <label className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-foreground">
                        Sheet tab
                        {availableSheets.length > 0 && (
                          <span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                            {availableSheets.length} found
                          </span>
                        )}
                      </label>
                      <select
                        value={selectedSheetName}
                        onChange={(e) => setSelectedSheetName(e.target.value)}
                        className={cn(sheetModalInputClasses, "pr-8")}
                        disabled={isImporting || isCreatingSheet}
                      >
                        <option value="">
                          {availableSheets.length > 0 ? "Use first worksheet" : "List worksheets to choose a tab"}
                        </option>
                        {availableSheets.map((sheetName, index) => (
                          <option key={index} value={sheetName}>
                            {sheetName}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-border/70 bg-muted px-5 py-4 text-xs text-muted-foreground">
                  <p><span className="font-medium text-foreground">Heads up:</span> New Sheets open in a new tab. If you import, ensure Composio has access to the document.</p>
                  <p className="mt-2">We automatically map rows into projects, entities, notes, or charts so your canvas stays structured.</p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Button
                    variant="outline"
                    className="sm:w-fit"
                    onClick={handleCloseSheetsModal}
                    disabled={isImporting || isCreatingSheet}
                  >
                    Close
                  </Button>
                  {viewState.syncSheetId && (
                    <span className="text-xs text-muted-foreground">
                      Currently linked to <span className="font-medium text-foreground">{viewState.syncSheetName || "Sheet1"}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Format Warning Modal */}
      {showFormatWarning && formatWarningDetails && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/85 px-4 py-8 backdrop-blur-sm sm:px-6">
          <div className="relative w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl sm:p-7">
            <div className="flex items-start justify-between gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-destructive/80">Import check</p>
                <h2 className="mt-1 text-lg font-semibold text-destructive">Format mismatch</h2>
                <p className="text-sm text-destructive/80">Replacing your canvas will overwrite existing cards with what’s in the Sheet.</p>
              </div>
              <button
                onClick={() => {
                  setShowFormatWarning(false);
                  setFormatWarningDetails(null);
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-destructive/70 transition-colors hover:border-destructive/40 hover:text-destructive"
                aria-label="Dismiss format warning"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 space-y-5">
              <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <p className="font-medium">Sheet details</p>
                <div className="mt-2 space-y-1 text-xs">
                  <p><span className="font-semibold uppercase tracking-wide">Sheet</span>: {formatWarningDetails.existingFormat}</p>
                  <p><span className="font-semibold uppercase tracking-wide">Canvas</span>: {formatWarningDetails.canvasFormat}</p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                Importing will completely replace your current canvas data with the sheet contents. Your existing cards will be lost unless they’re saved elsewhere.
              </p>

              <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                <Button
                  onClick={() => {
                    setShowFormatWarning(false);
                    const details = formatWarningDetails;
                    setFormatWarningDetails(null);
                    // Force import despite format mismatch
                    importFromSheet(details.sheetId, details.sheetName, true);
                  }}
                  variant="destructive"
                  className="flex-1"
                >
                  Replace canvas with sheet
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowFormatWarning(false);
                    setFormatWarningDetails(null);
                  }}
                  className="flex-1"
                >
                  Keep current canvas
                </Button>
              </div>

              <div className="rounded-2xl border border-border/70 bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Tip</p>
                <p className="mt-1">Consider creating a new Sheet or exporting your canvas JSON before importing if you might need to roll back.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

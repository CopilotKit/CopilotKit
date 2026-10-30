"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import type { GenerativeUIConfig } from "@copilotkit/react-core/v2/generative-ui";
import { playgroundTheme, playgroundUI } from "@/a2ui/catalog/catalog";
import {
  MODEL_OPTIONS,
  type Format,
  type ModelChoice,
  type ModelId,
} from "@/lib/model-options";
import { surfaceRenderer } from "./surface-renderer";

export type Mode = "auto" | "fixed" | "dynamic";

const DEFAULT_CHOICES: ModelChoice[] = MODEL_OPTIONS.map((m) => ({
  ...m,
  available: true,
}));

type Settings = {
  mode: Mode;
  setMode: (m: Mode) => void;
  model: ModelId;
  setModel: (m: ModelId) => void;
  format: Format;
  setFormat: (f: Format) => void;
  /** Every model, with whether it can run on this server (`GET /api/models`). */
  models: ModelChoice[];
};
const ModeContext = createContext<Settings>({
  mode: "auto",
  setMode: () => {},
  model: "gemini",
  setModel: () => {},
  format: "express",
  setFormat: () => {},
  models: DEFAULT_CHOICES,
});
/** The run settings: mode (fixed, dynamic or auto), model and the format the composer writes. */
export const useMode = () => useContext(ModeContext);

/** Which models can run here, from the server. Until it answers (or if it can't), every model shows as available. */
function useModelChoices() {
  const [models, setModels] = useState(DEFAULT_CHOICES);
  useEffect(() => {
    let live = true;
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { models?: Array<Omit<ModelChoice, "label">> } | null) => {
        if (!live || !Array.isArray(body?.models)) return;
        const byId = new Map(body.models.map((m) => [m.id, m]));
        setModels(
          DEFAULT_CHOICES.map((m) => ({
            ...m,
            ...byId.get(m.id),
            label: m.label,
          })),
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return models;
}

const SETTINGS_KEY = "a2ui-run-settings";

/** Model and format, kept for this viewer across visits. */
function useStoredChoice() {
  const [model, setModelState] = useState<ModelId>("gemini");
  const [format, setFormatState] = useState<Format>("express");
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as {
        model?: ModelId;
        format?: Format;
      };
      if (saved.model && MODEL_OPTIONS.some((m) => m.id === saved.model))
        setModelState(saved.model);
      if (saved.format === "json" || saved.format === "express")
        setFormatState(saved.format);
    } catch {}
  }, []);
  const save = (next: { model?: ModelId; format?: Format }) => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ model, format, ...next }),
      );
    } catch {}
  };
  return {
    model,
    format,
    setModelForNow: setModelState,
    setModel: (m: ModelId) => {
      setModelState(m);
      save({ model: m });
    },
    setFormat: (f: Format) => {
      setFormatState(f);
      save({ format: f });
    },
  };
}

const RENDERERS = [surfaceRenderer];

/**
 * Gen UI 2.0 with the tool transport: the browser sends the catalog to the
 * agent in the generative UI envelope, the agent streams A2UI v1.0
 * `generative-ui-surface` activities back, and CopilotKit renders them.
 */
const GENERATIVE_UI: GenerativeUIConfig = {
  ui: playgroundUI,
  theme: playgroundTheme,
  transport: "tool",
};

export function Providers({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>("auto");
  const { model, setModel, format, setFormat, setModelForNow } =
    useStoredChoice();
  const models = useModelChoices();
  // The saved model can't run here: use the first one that can, without overwriting the visitor's choice.
  useEffect(() => {
    if (models.find((m) => m.id === model)?.available !== false) return;
    const next = models.find((m) => m.available);
    if (next) setModelForNow(next.id);
  }, [models, model, setModelForNow]);
  useEffect(() => {
    // Test hooks for the headless driver (scripts/drive.mjs).
    const w = window as unknown as {
      __setMode?: (m: Mode) => void;
      __a2uiMode?: Mode;
      __a2uiModel?: ModelId;
      __a2uiFormat?: Format;
      __setFormat?: (f: Format) => void;
      __setModel?: (m: ModelId) => void;
    };
    w.__setMode = setMode;
    w.__setFormat = setFormat;
    w.__setModel = setModel;
    w.__a2uiMode = mode;
    w.__a2uiModel = model;
    w.__a2uiFormat = format;
  }, [mode, model, format, setFormat, setModel]);
  // `properties` reach the agent as `forwardedProps`: the router reads `mode`, `model` and `format` from there.
  const properties = useMemo(
    () => ({ mode, model, format }),
    [mode, model, format],
  );
  return (
    <ModeContext.Provider
      value={{ mode, setMode, model, setModel, format, setFormat, models }}
    >
      <CopilotKitProvider
        runtimeUrl="/api/copilotkit"
        properties={properties}
        generativeUI={GENERATIVE_UI}
        renderActivityMessages={RENDERERS}
        enableInspector={false}
      >
        {children}
      </CopilotKitProvider>
    </ModeContext.Provider>
  );
}

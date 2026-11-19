"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import { DEFAULT_MODEL, MODELS, MODEL_STORAGE_KEY } from "./models";

interface ModelState {
  model: string;
  setModel: (id: string) => void;
}

const ModelContext = createContext<ModelState | null>(null);

function readStoredModel(): string | null {
  try {
    const id = window.localStorage.getItem(MODEL_STORAGE_KEY);
    return id && MODELS.some((m) => m.id === id) ? id : null;
  } catch {
    return null;
  }
}

/** Holds the chosen Gemini model and remembers it between visits. */
export function ModelProvider({ children }: { children: ReactNode }) {
  const [model, setModelState] = useState(DEFAULT_MODEL);

  // Read after mount, so the server render and the first client render agree.
  useEffect(() => {
    const stored = readStoredModel();
    if (stored) setModelState(stored);
  }, []);

  const setModel = useCallback((id: string) => {
    setModelState(id);
    try {
      window.localStorage.setItem(MODEL_STORAGE_KEY, id);
    } catch {
      // Private windows can refuse storage; the choice still holds for now.
    }
  }, []);

  return (
    <ModelContext.Provider value={{ model, setModel }}>
      {children}
    </ModelContext.Provider>
  );
}

export function useModel(): ModelState {
  const state = useContext(ModelContext);
  if (!state) throw new Error("useModel needs <ModelProvider>");
  return state;
}

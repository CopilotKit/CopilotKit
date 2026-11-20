"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_MODEL,
  DEFAULT_PATH,
  MODELS,
  MODEL_STORAGE_KEY,
  PATH_STORAGE_KEY,
  RENDER_PATHS,
} from "./models";
import type { RenderPath } from "./models";

interface ModelState {
  model: string;
  setModel: (id: string) => void;
  path: RenderPath["id"];
  setPath: (id: RenderPath["id"]) => void;
}

const ModelContext = createContext<ModelState | null>(null);

function read(key: string, allowed: readonly { id: string }[]): string | null {
  try {
    const id = window.localStorage.getItem(key);
    return id && allowed.some((item) => item.id === id) ? id : null;
  } catch {
    return null;
  }
}

function write(key: string, id: string) {
  try {
    window.localStorage.setItem(key, id);
  } catch {
    // Private windows can refuse storage; the choice still holds for now.
  }
}

/** Holds the chosen model and rendering path, remembered between visits. */
export function ModelProvider({ children }: { children: ReactNode }) {
  const [model, setModelState] = useState(DEFAULT_MODEL);
  const [path, setPathState] = useState<RenderPath["id"]>(DEFAULT_PATH);

  // Read after mount, so the server render and the first client render agree.
  useEffect(() => {
    const storedModel = read(MODEL_STORAGE_KEY, MODELS);
    if (storedModel) setModelState(storedModel);
    const storedPath = read(PATH_STORAGE_KEY, RENDER_PATHS);
    if (storedPath) setPathState(storedPath as RenderPath["id"]);
  }, []);

  const setModel = useCallback((id: string) => {
    setModelState(id);
    write(MODEL_STORAGE_KEY, id);
  }, []);

  const setPath = useCallback((id: RenderPath["id"]) => {
    setPathState(id);
    write(PATH_STORAGE_KEY, id);
  }, []);

  return (
    <ModelContext.Provider value={{ model, setModel, path, setPath }}>
      {children}
    </ModelContext.Provider>
  );
}

export function useModel(): ModelState {
  const state = useContext(ModelContext);
  if (!state) throw new Error("useModel needs <ModelProvider>");
  return state;
}

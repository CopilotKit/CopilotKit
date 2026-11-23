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
  /** Switches the model now, and remembers it if the browser lets us. */
  setModel: (id: string) => void;
  path: RenderPath["id"];
  /** Switches the drawing path now, and remembers it if the browser lets us. */
  setPath: (id: RenderPath["id"]) => void;
  /**
   * Stores a choice for the next page load without switching to it. Returns
   * false when the browser refuses storage.
   */
  remember: (kind: "model" | "path", id: string) => boolean;
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

/** Whether the browser stored it: private windows and blocked site data refuse. */
function write(key: string, id: string): boolean {
  try {
    window.localStorage.setItem(key, id);
    return window.localStorage.getItem(key) === id;
  } catch {
    return false;
  }
}

const STORAGE_KEYS = { model: MODEL_STORAGE_KEY, path: PATH_STORAGE_KEY };

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

  // Without storage the choice still holds until the page reloads.
  const setModel = useCallback((id: string) => {
    setModelState(id);
    write(MODEL_STORAGE_KEY, id);
  }, []);

  const setPath = useCallback((id: RenderPath["id"]) => {
    setPathState(id);
    write(PATH_STORAGE_KEY, id);
  }, []);

  const remember = useCallback(
    (kind: "model" | "path", id: string) => write(STORAGE_KEYS[kind], id),
    [],
  );

  return (
    <ModelContext.Provider value={{ model, setModel, path, setPath, remember }}>
      {children}
    </ModelContext.Provider>
  );
}

export function useModel(): ModelState {
  const state = useContext(ModelContext);
  if (!state) throw new Error("useModel needs <ModelProvider>");
  return state;
}

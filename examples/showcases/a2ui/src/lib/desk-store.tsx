import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { ViewKind } from "./view-catalog";

export interface Note {
  id: string;
  title: string;
  text: string;
  sourceUrl?: string;
  savedAt: number;
}

interface DeskStore {
  notes: Note[];
  addNote: (note: Omit<Note, "id" | "savedAt">) => void;
  removeNote: (id: string) => void;
  /** One quiet line at the foot of the chat that confirms what a button did. */
  status: Status | null;
  announce: (text: string, action?: StatusAction) => void;
  holdStatus: (held: boolean) => void;
  /** The view the reader asked for from the + menu, sent with the next question. */
  viewRequest: ViewKind | null;
  requestView: (view: ViewKind | null) => void;
}

export interface StatusAction {
  label: string;
  run: () => void;
}

interface Status {
  id: number;
  text: string;
  action?: StatusAction;
}

const NOTES_KEY = "research-desk:notes";
const DeskContext = createContext<DeskStore | null>(null);

function readNotes(): Note[] {
  try {
    const raw = window.localStorage.getItem(NOTES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Note[]) : [];
  } catch {
    return [];
  }
}

export function DeskProvider({ children }: { children: ReactNode }) {
  // null until storage is read, so nothing writes an empty list over saved
  // notes (React runs mount effects twice in development).
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [status, setStatus] = useState<DeskStore["status"]>(null);
  const [viewRequest, requestView] = useState<ViewKind | null>(null);
  const statusTimer = useRef<number | undefined>(undefined);
  const statusDuration = useRef(0);

  useEffect(() => setNotes(readNotes()), []);

  useEffect(() => {
    if (notes) window.localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  }, [notes]);

  const scheduleClear = useCallback((ms: number) => {
    window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(null), ms);
  }, []);

  const announce = useCallback(
    (text: string, action?: StatusAction) => {
      setStatus({ id: Date.now(), text, action });
      // A message with an action stays long enough to reach it.
      statusDuration.current = action ? 8000 : 3200;
      scheduleClear(statusDuration.current);
    },
    [scheduleClear],
  );

  /** The status stays while the reader hovers or focuses it. */
  const holdStatus = useCallback(
    (held: boolean) => {
      if (held) window.clearTimeout(statusTimer.current);
      else scheduleClear(statusDuration.current);
    },
    [scheduleClear],
  );

  const addNote = useCallback((note: Omit<Note, "id" | "savedAt">) => {
    setNotes((current) => [
      { ...note, id: crypto.randomUUID(), savedAt: Date.now() },
      ...(current ?? []).filter(
        (n) => n.title !== note.title || n.text !== note.text,
      ),
    ]);
  }, []);

  const removeNote = useCallback((id: string) => {
    setNotes((current) => (current ?? []).filter((note) => note.id !== id));
  }, []);

  const value = useMemo(
    () => ({
      notes: notes ?? [],
      addNote,
      removeNote,
      status,
      announce,
      holdStatus,
      viewRequest,
      requestView,
    }),
    [notes, addNote, removeNote, status, announce, holdStatus, viewRequest],
  );
  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}

export function useDesk(): DeskStore {
  const store = useContext(DeskContext);
  if (!store) throw new Error("useDesk must be used inside <DeskProvider>");
  return store;
}

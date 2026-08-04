"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * "Recording" state for the self-learning teach-mode UX.
 *
 * While the officer demonstrates an action that the agent will learn from
 * (filing a policy exception, approving/denying a transaction), the UI brackets
 * the demonstration with `beginRecording()` / `endRecording()`. This context
 * exposes a single boolean — `isRecording` — that is true for the duration of a
 * demonstration, plus the ref-counted bracket calls themselves.
 *
 * Two design points make it demo-friendly:
 *  - **Ref-counted:** overlapping brackets (e.g. exception `opened` immediately
 *    followed by `finalized`) keep the flag continuously on instead of
 *    flickering off between steps.
 *  - **Minimum visible duration:** a fire-and-forget bracket resolves almost
 *    instantly; without a floor the vignette would never be seen. We hold
 *    `isRecording` true for at least `MIN_VISIBLE_MS` so the pulse is always
 *    perceptible.
 *
 * It is purely a presentational signal: it reflects that the UI is in the
 * middle of capturing a demonstration.
 */

const MIN_VISIBLE_MS = 1200;

// A single human-readable line in the visible recorder feed — one per UI action
// the officer performs during a demonstration ("Opened the Dashboard",
// "Approved the charge"). UI-only: these are NEVER sent to the agent, so they
// may use plain human language without touching the learning invariant.
export interface RecordedStep {
  id: number;
  label: string;
}

interface RecordingContextValue {
  isRecording: boolean;
  beginRecording: () => void;
  endRecording: () => void;
  // The ordered feed of UI actions captured during the current demonstration,
  // surfaced live by <RecordingFeed/>. Cleared at the start of each new
  // demonstration (the first beginRecording of a fresh window).
  steps: RecordedStep[];
  // Append a step to the feed. A no-op unless a demonstration is active, so call
  // sites (nav links, tabs, buttons) can call it unconditionally — it only
  // records while the officer is actually being watched.
  logStep: (label: string) => void;
  // The exception code the officer used in the most recent demonstration.
  // The dashboard demonstration (file exception + approve) happens OUTSIDE the
  // chat HITL flow, so the agent can't see which code was chosen. The inline
  // exception card reports it here via `noteDemonstratedCode`; the chat's
  // `awaitDashboardDemonstration` card reads it back with `getDemonstratedCode`
  // at click time (a ref, so it never captures a stale value) and hands it to
  // saveLearnedWorkflow.
  noteDemonstratedCode: (code: string) => void;
  getDemonstratedCode: () => string | null;
}

const RecordingContext = createContext<RecordingContextValue | null>(null);

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const [isRecording, setIsRecording] = useState(false);
  // The visible recorder feed (one line per officer UI action this demonstration).
  const [steps, setSteps] = useState<RecordedStep[]>([]);

  // All mutable bookkeeping lives in refs so begin/endRecording keep stable
  // identities (empty dep arrays) and never read stale state.
  const countRef = useRef(0);
  const activeRef = useRef(false);
  const startRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepIdRef = useRef(0);
  // Latest demonstrated exception code. A ref (not state) so reads at click
  // time always see the most recent value even from a render closure captured
  // earlier — the waiting card renders before the officer files on the
  // dashboard, so a stateful read would be stale.
  const demonstratedCodeRef = useRef<string | null>(null);

  const beginRecording = useCallback(() => {
    countRef.current += 1;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!activeRef.current) {
      activeRef.current = true;
      startRef.current = Date.now();
      // Fresh demonstration window — reset the visible feed so it shows only
      // the actions from THIS recording, not a previous one.
      stepIdRef.current = 0;
      setSteps([]);
      setIsRecording(true);
    }
  }, []);

  const endRecording = useCallback(() => {
    countRef.current = Math.max(0, countRef.current - 1);
    if (countRef.current > 0) return; // still recording other steps

    const elapsed = Date.now() - startRef.current;
    const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // A new record may have started during the hold — only turn off if the
      // ref-count is still at zero.
      if (countRef.current === 0) {
        activeRef.current = false;
        setIsRecording(false);
      }
    }, remaining);
  }, []);

  // Append a feed line. Gated on activeRef (the synchronous ref, never stale) so
  // call sites — global nav links, dashboard tabs, list buttons — can call it
  // unconditionally and it only records while a demonstration is live. Drops a
  // line that exactly repeats the previous one (e.g. clicking the same tab
  // twice) to keep the feed clean.
  const logStep = useCallback((label: string) => {
    if (!activeRef.current) return;
    setSteps((prev) => {
      if (prev.length > 0 && prev[prev.length - 1].label === label) return prev;
      stepIdRef.current += 1;
      return [...prev, { id: stepIdRef.current, label }];
    });
  }, []);

  const noteDemonstratedCode = useCallback((code: string) => {
    demonstratedCodeRef.current = code;
  }, []);

  const getDemonstratedCode = useCallback(
    () => demonstratedCodeRef.current,
    [],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const value = useMemo(
    () => ({
      isRecording,
      beginRecording,
      endRecording,
      steps,
      logStep,
      noteDemonstratedCode,
      getDemonstratedCode,
    }),
    [
      isRecording,
      beginRecording,
      endRecording,
      steps,
      logStep,
      noteDemonstratedCode,
      getDemonstratedCode,
    ],
  );

  return (
    <RecordingContext.Provider value={value}>
      {children}
    </RecordingContext.Provider>
  );
}

/**
 * Read the recording state. Tolerates being called outside a
 * `RecordingProvider` (returns a no-op) so call sites — e.g. a read-only
 * transactions list rendered on a page that isn't wrapped — never need to
 * guard.
 */
export function useRecording(): RecordingContextValue {
  const ctx = useContext(RecordingContext);
  if (!ctx) {
    return {
      isRecording: false,
      beginRecording: () => {},
      endRecording: () => {},
      steps: [],
      logStep: () => {},
      noteDemonstratedCode: () => {},
      getDemonstratedCode: () => null,
    };
  }
  return ctx;
}

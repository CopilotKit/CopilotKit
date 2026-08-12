"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

/**
 * BEAT 6, role #3 — RECORDING.
 *
 * While the human demonstrates the out-of-band unlock on the Compensation page,
 * the agent holds the chat with a waiting card and this context narrates each
 * real action as it happens. Two things about the design are deliberate:
 *
 *  - It records what the human ACTUALLY DID, not what the UI offered. The code
 *    that lifts the gate is captured from the exception the human actually
 *    filed (`getDemonstratedCode`), so the saved procedure names the real code
 *    rather than a guess. If the human files a DECOY, the recording faithfully
 *    captures the decoy — and the approve still fails, which is the honest
 *    outcome and a far better demo than a recorder that quietly corrects them.
 *
 *  - `beginRecording` / `endRecording` are REF-COUNTED. The waiting card can
 *    re-render, remount on a thread switch, or briefly double-mount in React
 *    strict mode; a boolean flag would be switched off by the first unmount and
 *    the feed would go dead mid-demonstration while everything still looked
 *    fine. A counter survives all three.
 */

export interface RecordedStep {
  id: string;
  label: string;
  at: number;
  /** Set when the step is the one that filed a band exception. */
  code?: string;
}

interface RecordingValue {
  isRecording: boolean;
  steps: RecordedStep[];
  beginRecording: () => void;
  endRecording: () => void;
  logStep: (label: string, code?: string) => void;
  /** The exception code the human actually filed during this demonstration. */
  getDemonstratedCode: () => string | null;
  reset: () => void;
}

const RecordingContext = createContext<RecordingValue | null>(null);

export function RecordingProvider({ children }: { children: ReactNode }) {
  const [depth, setDepth] = useState(0);
  const [steps, setSteps] = useState<RecordedStep[]>([]);
  // A ref as well as state: `logStep` is called from event handlers that may
  // have closed over a stale `depth`, and dropping a step because the closure
  // was one render behind is invisible until the feed is missing a line.
  const depthRef = useRef(0);

  const beginRecording = useCallback(() => {
    depthRef.current += 1;
    setDepth(depthRef.current);
  }, []);

  const endRecording = useCallback(() => {
    depthRef.current = Math.max(0, depthRef.current - 1);
    setDepth(depthRef.current);
  }, []);

  const logStep = useCallback((label: string, code?: string) => {
    if (depthRef.current === 0) return;
    setSteps((prev) => [
      ...prev,
      { id: `${Date.now()}-${prev.length}`, label, at: Date.now(), code },
    ]);
  }, []);

  const value = useMemo<RecordingValue>(
    () => ({
      isRecording: depth > 0,
      steps,
      beginRecording,
      endRecording,
      logStep,
      getDemonstratedCode: () =>
        [...steps].toReversed().find((s) => s.code)?.code ?? null,
      reset: () => setSteps([]),
    }),
    [depth, steps, beginRecording, endRecording, logStep],
  );

  return (
    <RecordingContext.Provider value={value}>
      {children}
    </RecordingContext.Provider>
  );
}

/**
 * Safe to call from anywhere, including pages that mount outside the provider
 * during a route transition. Returns inert no-ops rather than throwing: a page
 * that logs a step is doing optional narration, and crashing the roster because
 * the recorder was not mounted would be a much worse failure than a missing
 * line in a feed.
 */
export function useRecording(): RecordingValue {
  return (
    useContext(RecordingContext) ?? {
      isRecording: false,
      steps: [],
      beginRecording: () => {},
      endRecording: () => {},
      logStep: () => {},
      getDemonstratedCode: () => null,
      reset: () => {},
    }
  );
}

/**
 * The edge glow that tells a room recording is live. Mounted once, below the
 * CopilotKit provider, and pointer-events-none so it never intercepts the very
 * clicks it exists to watch.
 */
export function RecordingVignette() {
  const { isRecording } = useRecording();
  if (!isRecording) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[1300] rounded-none"
      style={{
        boxShadow: "inset 0 0 0 3px hsl(var(--brand) / 0.55)",
        animation: "rowan-record-breathe 2.4s ease-in-out infinite",
      }}
    />
  );
}

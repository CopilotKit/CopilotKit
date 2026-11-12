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
import type { ReactNode } from "react";

/**
 * Teach-mode recording — the ONE implementation, owned by the shell.
 *
 * While an operator demonstrates the action the agent is learning (filing an
 * exception, filing a waiver, approving a gated write), the UI brackets the
 * demonstration with `beginRecording()` / `endRecording()`. This context is the
 * visible signal that the agent is watching, plus the ordered feed of what it
 * saw.
 *
 * It lives in the shell rather than per skin because three skins had already
 * shipped three copies that DIVERGED, and every failure mode here is silent:
 * `useRecording` returns inert no-ops outside a provider and `logStep` returns
 * early when idle, so a broken copy does not throw — the feed is simply empty
 * and the glow never appears, discovered on stage. This implementation is the
 * union of the three:
 *
 *  - **Ref-counted** (all three had this). Overlapping brackets — an exception
 *    `opened` immediately followed by `finalized`, a card remounting on a thread
 *    switch, React strict mode's double-mount — keep the flag continuously on
 *    instead of flickering off.
 *  - **Minimum visible duration** (banking only). A fire-and-forget bracket
 *    resolves in milliseconds; without a floor the glow is never perceived.
 *  - **Feed de-dupe and fresh-window reset** (banking only). Clicking the same
 *    tab twice does not double the feed, and a second demonstration does not
 *    open showing the first one's steps — once the MIN_VISIBLE_MS hold has
 *    expired. A `beginRecording()` DURING the hold deliberately inherits the
 *    existing feed instead of clearing it: that is the `opened → finalized →
 *    approve` chain arriving as three brackets microseconds apart, and it must
 *    read as one continuous demonstration, not three that each wipe the last.
 *    Not a bug — the continuity is the point.
 *  - **Demonstrated code DERIVED from the feed** (commerce and people only).
 *    The code that lifted the gate is whatever the human actually filed, so
 *    filing a DECOY records the decoy and the write correctly still fails. A
 *    recorder that quietly corrects the operator would prove nothing.
 *
 * Step labels are the SKIN's vocabulary, passed in as strings. The shell owns
 * the state machine and the chrome, never the domain language.
 */

const MIN_VISIBLE_MS = 1200;

export interface RecordedStep {
  id: number;
  label: string;
  /** Set on the step that filed the code lifting the gate. */
  code?: string;
}

export interface RecordingValue {
  isRecording: boolean;
  /**
   * Readonly on purpose. Consumers only ever read the feed (`.length`, `.map`),
   * and the no-provider fallback below hands every out-of-provider consumer the
   * SAME frozen array — a mutable type would invite one consumer to splice a
   * shared singleton out from under all the others. It also lets the frozen
   * fallback type-check without an assertion: `Object.freeze([])` is
   * `readonly never[]`, which widens to `readonly RecordedStep[]` but cannot be
   * cast to `RecordedStep[]` (TS2352).
   */
  steps: readonly RecordedStep[];
  beginRecording: () => void;
  endRecording: () => void;
  /** No-op while idle, so call sites can call it unconditionally. */
  logStep: (label: string, code?: string) => void;
  /** The code the human actually filed this window, or null. */
  getDemonstratedCode: () => string | null;
}

const RecordingContext = createContext<RecordingValue | null>(null);

/**
 * The no-provider fallback, allocated ONCE at module scope rather than per
 * render. A fresh object literal each render would hand every consumer outside
 * a provider new `logStep` / `beginRecording` identities on every pass, so any
 * call site listing them in a `useEffect` or `useMemo` dep array would re-run
 * forever. No current call site is exposed, but this module ships to every
 * registered skin, and an infinite render loop is a far more expensive bug than the
 * missing feed line the fallback exists to tolerate. Frozen so a consumer
 * cannot mutate the shared instance out from under every other consumer.
 */
const INERT_RECORDING: RecordingValue = Object.freeze({
  isRecording: false,
  steps: Object.freeze([]),
  beginRecording: () => {},
  endRecording: () => {},
  logStep: () => {},
  getDemonstratedCode: () => null,
});

export function RecordingProvider({ children }: { children: ReactNode }) {
  const [isRecording, setIsRecording] = useState(false);
  const [steps, setSteps] = useState<RecordedStep[]>([]);

  // All mutable bookkeeping lives in refs so begin/end/logStep keep stable
  // identities (empty dep arrays) and never read stale state from a closure
  // captured a render earlier — dropping a step because the closure was one
  // render behind is invisible until the feed is missing a line.
  const countRef = useRef(0);
  const activeRef = useRef(false);
  const startRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepIdRef = useRef(0);
  const stepsRef = useRef<RecordedStep[]>([]);

  const beginRecording = useCallback(() => {
    countRef.current += 1;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!activeRef.current) {
      activeRef.current = true;
      startRef.current = Date.now();
      stepIdRef.current = 0;
      stepsRef.current = [];
      setSteps([]);
      setIsRecording(true);
    }
  }, []);

  const endRecording = useCallback(() => {
    countRef.current = Math.max(0, countRef.current - 1);
    if (countRef.current > 0) return; // other brackets still open

    const remaining = Math.max(
      0,
      MIN_VISIBLE_MS - (Date.now() - startRef.current),
    );
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // A new window may have opened during the hold.
      if (countRef.current === 0) {
        activeRef.current = false;
        setIsRecording(false);
      }
    }, remaining);
  }, []);

  const logStep = useCallback((label: string, code?: string) => {
    if (!activeRef.current) return;
    setSteps((prev) => {
      if (prev.length > 0 && prev[prev.length - 1].label === label) return prev;
      stepIdRef.current += 1;
      const next = [...prev, { id: stepIdRef.current, label, code }];
      // Mirrored into a ref so getDemonstratedCode reads the latest value even
      // from a render closure captured before the operator acted.
      stepsRef.current = next;
      return next;
    });
  }, []);

  // The LAST coded step wins: the operator may file a decoy, be refused, then
  // file the real code, and the gate must see the second one.
  //
  // `[...x].reverse()` and not `x.toReversed()` on purpose. toReversed() is
  // ES2023 while tsconfig targets ES2017, and TypeScript does not downlevel
  // methods or ship a polyfill — `lib: ["esnext"]` makes it type-check clean, so
  // using it would silently raise this demo's browser floor to Chrome 110 /
  // Safari 16.4 with nothing failing at build time. The spread is required
  // because reverse() mutates. oxlint's unicorn/no-array-reverse would autofix
  // this back on every commit (lefthook runs `oxlint --fix` with stage_fixed),
  // so the disable is load-bearing, not decorative — do not "clean it up".
  //
  // It must be `oxlint-disable-next-line`, NOT `eslint-disable-next-line`: this
  // app runs both linters, and ESLint has no unicorn plugin loaded, so the
  // eslint- form fails `pnpm lint` with "Definition for rule ... was not found".
  // The oxlint- form silences the autofixer and reads as a plain comment to
  // ESLint, which is the only spelling that satisfies both.
  const getDemonstratedCode = useCallback(
    // oxlint-disable-next-line unicorn/no-array-reverse -- ES2017 target; see above
    () => [...stepsRef.current].reverse().find((s) => s.code)?.code ?? null,
    [],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const value = useMemo<RecordingValue>(
    () => ({
      isRecording,
      steps,
      beginRecording,
      endRecording,
      logStep,
      getDemonstratedCode,
    }),
    [
      isRecording,
      steps,
      beginRecording,
      endRecording,
      logStep,
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
 * Safe to call anywhere, including a page mounting outside the provider during
 * a route transition. Returns inert no-ops rather than throwing: logging a step
 * is optional narration, and crashing a page because the recorder was not
 * mounted is a far worse failure than a missing feed line.
 */
export function useRecording(): RecordingValue {
  return useContext(RecordingContext) ?? INERT_RECORDING;
}

/**
 * The live feed, rendered INSIDE the chat (within the skin's "waiting for your
 * demonstration" HITL card) so it reads as a conversation card rather than a
 * floating overlay.
 *
 * It is its own component, not inlined into the card's render closure, so it
 * subscribes to the context directly and re-renders as each action is logged —
 * independent of whether the host card's render re-runs, which would otherwise
 * freeze on a stale `steps` snapshot.
 */
export function RecordingFeed() {
  const { steps } = useRecording();

  if (steps.length === 0) {
    return (
      <p className="text-sm italic text-ink-muted">
        Waiting for your first action…
      </p>
    );
  }

  return (
    <ol className="space-y-1.5">
      {steps.map((step, i) => (
        <li key={step.id} className="flex items-center gap-2.5 text-sm">
          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-soft text-[0.65rem] font-semibold text-brand-indigo dark:text-brand-violet">
            {i + 1}
          </span>
          <span className="text-ink">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The canvas-edge glow that tells a room recording is live. Purely
 * presentational and non-blocking: a fixed full-viewport overlay with
 * `pointer-events: none`, driven by the `data-recording` attribute. All styling
 * lives in the shell's `globals.css` under `.recording-vignette`, valued from
 * the shared `--brand-violet` / `--brand-indigo` tokens — so it reskins with
 * each skin's `theme.css` and needs no per-skin copy.
 */
export function RecordingVignette() {
  const { isRecording } = useRecording();
  return (
    <div
      aria-hidden
      data-recording={isRecording ? "true" : "false"}
      className="recording-vignette"
    />
  );
}

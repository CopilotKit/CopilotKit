import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

/**
 * Shared invalidation counter for the Learning surfaces.
 *
 * The Learning rail renders in the shell's sidebar slot, outside the project
 * route tree, so it cannot see the Learning page's state. Creating a Container,
 * renaming one, or starting an analysis all change what the rail must show.
 * A bumped counter is the smallest thing that can cross that boundary, and it
 * keeps the rail's reads declarative rather than imperative.
 */
interface LearningRefreshValue {
  /** Invalidates every Learning read that depends on the signal. */
  readonly refresh: () => void;
  /** Changes whenever Learning data may be stale. */
  readonly signal: number;
}

const LearningRefreshContext = createContext<LearningRefreshValue | null>(null);

/**
 * Provides one invalidation counter to the Learning rail and the Learning page.
 *
 * @param props - Subtree that shares the counter.
 * @returns The provider wrapping its children.
 */
export function LearningRefreshProvider(props: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const [signal, setSignal] = useState(0);
  const refresh = useCallback(() => {
    setSignal((current) => current + 1);
  }, []);
  const value = useMemo<LearningRefreshValue>(
    () => ({ refresh, signal }),
    [refresh, signal],
  );

  return (
    <LearningRefreshContext.Provider value={value}>
      {props.children}
    </LearningRefreshContext.Provider>
  );
}

/**
 * Reads the current Learning invalidation signal.
 *
 * Returns `0` with no provider mounted so a component can be unit tested, and
 * rendered on a surface that has no Learning rail, without extra scaffolding.
 *
 * @returns The signal to include in read dependencies.
 */
export function useLearningRefreshSignal(): number {
  return useContext(LearningRefreshContext)?.signal ?? 0;
}

/**
 * Returns the callback that marks Learning data stale.
 *
 * Outside a provider this is a no-op rather than an error: a Learning view can
 * legitimately render without a rail to invalidate.
 *
 * @returns A stable refresh callback.
 */
export function useLearningRefresh(): () => void {
  const context = useContext(LearningRefreshContext);
  const noop = useCallback(() => undefined, []);
  return context?.refresh ?? noop;
}

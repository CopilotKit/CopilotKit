import { useEffect, useReducer, useRef } from "react";
import type { MutableRefObject } from "react";

/** The part of a core this hook needs: something it can dispose. */
interface Disposable {
  dispose(): void;
}

/**
 * @internal Create a core for the provider's lifetime and dispose it on
 * unmount.
 *
 * The dispose waits one task. StrictMode (and Fast Refresh) unmount and
 * remount effects in the same commit, so the remount cancels the pending
 * dispose and the same core keeps working. When effects mount again after the
 * core was really disposed (for example an `<Activity>` that was hidden and
 * shown), the hook creates a new core and renders again: a disposed core is
 * never reused.
 *
 * `ref` holds the current core. The provider owns it, so code that runs
 * before the core exists can read `ref.current`.
 *
 * @example
 * const coreRef = useRef<CopilotKitCoreReact | null>(null);
 * const core = ɵuseOwnedCore(coreRef, () => new CopilotKitCoreReact(config));
 */
export function ɵuseOwnedCore<T extends Disposable>(
  ref: MutableRefObject<T | null>,
  create: () => T,
) {
  const createRef = useRef(create);
  createRef.current = create;
  const pendingDispose = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const disposedRef = useRef(false);
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const current = ref.current ?? create();
  ref.current = current;

  useEffect(() => {
    clearTimeout(pendingDispose.current);
    pendingDispose.current = undefined;
    let core = ref.current ?? createRef.current();
    if (disposedRef.current) {
      disposedRef.current = false;
      core = createRef.current();
      rerender();
    }
    ref.current = core;
    return () => {
      pendingDispose.current = setTimeout(() => {
        pendingDispose.current = undefined;
        disposedRef.current = true;
        core.dispose();
      }, 0);
    };
  }, [ref]);

  return current;
}

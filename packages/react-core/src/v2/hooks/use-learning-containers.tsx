import { useEffect, useRef } from "react";
import { useCopilotKit } from "../context";
import { recordAnnotation } from "../lib/record-annotation";

/** The default learning containers value. Matches the backend default. */
const DEFAULT_CONTAINERS: string[] = ["project"];

/**
 * Arguments for {@link useLearningContainers}.
 */
export interface UseLearningContainersArgs {
  /** Thread to apply the learning-container selection to. */
  threadId: string;
  /**
   * The ordered list of learning container identifiers to activate for this
   * thread. Defaults to `["project"]` on the backend when absent.
   */
  learningContainers: readonly string[];
}

/**
 * Declaratively keeps a thread's learning containers in sync by emitting
 * `set_learning_containers` annotations via the CopilotKit runtime annotate
 * endpoint (`POST ${runtimeUrl}/annotate`).
 *
 * **Emit rules:**
 * - On mount with `["project"]` (the backend default) → does NOT emit.
 *   Absence of an annotation equals the default, so the round-trip is skipped.
 * - On mount with any other value → emits immediately.
 * - On any subsequent content change (including a switch back to
 *   `["project"]`) → emits (a deliberate switch is always recorded).
 * - On unmount or threadId change → emits a reset to `["project"]`
 *   so the backend is left in a clean state for the next consumer.
 *   Changing `learningContainers` within the same thread does NOT reset the
 *   thread; only the new value is emitted.
 *
 * Content-equality is evaluated via `JSON.stringify` so a fresh array literal
 * with the same items does NOT trigger a redundant emit.
 *
 * If `runtimeUrl` is absent, all emits are silently skipped.
 *
 * @example
 * ```tsx
 * function ThreadPane({ threadId, userScope }: Props) {
 *   useLearningContainers({
 *     threadId,
 *     learningContainers: [userScope],
 *   });
 *   // ...
 * }
 * ```
 */
export function useLearningContainers({
  threadId,
  learningContainers,
}: UseLearningContainersArgs): void {
  const { copilotkit } = useCopilotKit();

  /**
   * Tracks the last-synced container list so content-identical rerenders
   * (fresh array, same values) do not fire a redundant emit.
   * `null` = nothing synced yet (initial state or after a threadId reset).
   */
  const lastSyncedRef = useRef<readonly string[] | null>(null);

  /** Guards the missing-runtimeUrl warning so it fires at most once per hook instance. */
  const warnedMissingUrlRef = useRef(false);

  // Keep a ref to the latest transport values so the cleanup effect can read
  // them without being added to its dep array (which would cause it to re-run
  // and re-register on every render).
  const runtimeUrlRef = useRef<string | null | undefined>(
    copilotkit.runtimeUrl,
  );
  const headersRef = useRef<Record<string, string>>(copilotkit.headers ?? {});
  runtimeUrlRef.current = copilotkit.runtimeUrl;
  headersRef.current = copilotkit.headers ?? {};

  // Content-stable dependency: same items in same order → same key string.
  const key = JSON.stringify(learningContainers);
  const defaultKey = JSON.stringify(DEFAULT_CONTAINERS);

  // ── Effect 1: sync containers ──────────────────────────────────────────────
  // Fires on mount, on threadId change, and on container-content change.
  // Does NOT emit a reset on cleanup — container changes within the same thread
  // are direct transitions, not reset-then-set.
  // threadId changes are handled by Effect 2's cleanup.
  useEffect(() => {
    const runtimeUrl = copilotkit.runtimeUrl;
    const headers = copilotkit.headers ?? {};

    /**
     * Fire-and-forget emit; errors must not surface in render.
     * Failures are logged as warnings so they are diagnosable without
     * propagating into the React render cycle.
     */
    const emit = (containers: readonly string[]): void => {
      if (!runtimeUrl) {
        if (!warnedMissingUrlRef.current) {
          warnedMissingUrlRef.current = true;
          console.warn(
            "useLearningContainers: runtimeUrl not configured; learning-container sync disabled",
          );
        }
        return;
      }
      recordAnnotation({
        runtimeUrl,
        headers,
        type: "set_learning_containers",
        payload: { containers },
        threadId,
      }).catch((err) => {
        console.warn(
          "useLearningContainers: failed to record set_learning_containers",
          err,
        );
      });
    };

    if (lastSyncedRef.current === null) {
      // First run (or after a threadId reset): skip if already on the default.
      if (key === defaultKey) {
        lastSyncedRef.current = learningContainers;
        return;
      }
      emit(learningContainers);
      lastSyncedRef.current = learningContainers;
    } else {
      // Subsequent runs: only emit when the content actually changed.
      const lastKey = JSON.stringify(lastSyncedRef.current);
      if (key !== lastKey) {
        emit(learningContainers);
        lastSyncedRef.current = learningContainers;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, key]);

  // ── Effect 2: unmount / threadId-change reset ──────────────────────────────
  // Runs whenever threadId changes and on unmount.
  // The cleanup emits the reset for the OLD threadId before the new one takes
  // over (or on final unmount). We intentionally do NOT re-run this effect when
  // runtimeUrl or headers change — we read the latest values via refs instead.
  useEffect(() => {
    // Capture the threadId that was active when this effect ran.
    const capturedThreadId = threadId;

    return () => {
      const capturedRuntimeUrl = runtimeUrlRef.current;
      const capturedHeaders = headersRef.current;

      if (capturedRuntimeUrl) {
        recordAnnotation({
          runtimeUrl: capturedRuntimeUrl,
          headers: capturedHeaders,
          type: "set_learning_containers",
          payload: { containers: DEFAULT_CONTAINERS },
          threadId: capturedThreadId,
        }).catch((err) => {
          console.warn(
            "useLearningContainers: failed to record set_learning_containers",
            err,
          );
        });
      }

      // Reset tracking so the next effect run (new threadId) starts fresh.
      lastSyncedRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);
}

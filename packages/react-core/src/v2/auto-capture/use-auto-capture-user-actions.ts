import { useEffect, useRef } from "react";
import { useCopilotKit } from "../context";
import { useCopilotChatConfiguration } from "../providers/CopilotChatConfigurationProvider";
import { useRecordUserAction } from "../hooks/use-record-user-action";
import {
  clearAutoCaptureDispatch,
  installAutoCapturePatches,
  setAutoCaptureDispatch,
  uninstallAutoCapturePatches,
} from "./bridge";
import { processExchange, resolveConfig } from "./pipeline";
import type { AutoCaptureUserActionsConfig, RawExchange } from "./types";

const MISSING_THREAD_WARNING =
  "[CopilotKit] auto-capture: no threadId is resolvable for a captured request " +
  "(no current chat thread in scope and no `threadId` configured). Skipping " +
  "capture. Mount `useAutoCaptureUserActions()` inside a chat (e.g. <CopilotChat>) " +
  "or pass `threadId` in the config.";

/**
 * Resolve the explicit `threadId` from config (string or resolver), or `null`
 * when none was supplied.
 */
const resolveExplicitThreadId = (
  threadId: AutoCaptureUserActionsConfig["threadId"],
): string | null => {
  if (typeof threadId === "function") {
    try {
      return threadId() || null;
    } catch {
      return null;
    }
  }
  return threadId ?? null;
};

/**
 * Enable automatic user-action capture for the subtree this hook is mounted in.
 *
 * While enabled, the browser's global `fetch` and `XMLHttpRequest` are patched
 * (once, lazily) so that mutating requests are recorded as user actions through
 * the same {@link useRecordUserAction} pipeline — no per-site instrumentation.
 * The patch is removed when the last consumer unmounts; if auto-capture is never
 * enabled, the globals are never touched.
 *
 * The thread a captured action is recorded under is resolved as: an explicit
 * `config.threadId` (string or resolver) → the current chat thread from the
 * surrounding `CopilotChatConfigurationProvider` → otherwise the capture is
 * skipped with a one-time console warning. Mount this hook inside a chat to get
 * "current thread" behavior for free.
 *
 * @example
 * ```tsx
 * function App() {
 *   useAutoCaptureUserActions({
 *     enabled: true,
 *     redact: { keys: ["taxId"] },
 *   });
 *   return <YourRoutes />;
 * }
 * ```
 */
export function useAutoCaptureUserActions(
  config: AutoCaptureUserActionsConfig = {},
): void {
  const { copilotkit } = useCopilotKit();
  const chatConfig = useCopilotChatConfiguration();
  const recordUserAction = useRecordUserAction();

  const enabled = config.enabled !== false;

  // Hold the latest inputs in a ref so the bridge dispatcher reads current
  // values without re-installing the patch on every render.
  const latest = useRef({ config, copilotkit, chatConfig, recordUserAction });
  latest.current = { config, copilotkit, chatConfig, recordUserAction };
  const warnedRef = useRef(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const dispatch = (raw: RawExchange): void => {
      const current = latest.current;
      processExchange(raw, {
        config: resolveConfig(current.config),
        origin: window.location.origin,
        runtimeUrl: current.copilotkit.runtimeUrl,
        resolveThreadId: () =>
          resolveExplicitThreadId(current.config.threadId) ??
          current.chatConfig?.threadId ??
          null,
        record: (input) => {
          void current.recordUserAction(input).catch(() => {
            // Recording is best-effort; never surface into the host app.
          });
        },
        onMissingThread: () => {
          if (warnedRef.current) return;
          warnedRef.current = true;
          // eslint-disable-next-line no-console
          console.warn(MISSING_THREAD_WARNING);
        },
      });
    };

    setAutoCaptureDispatch(dispatch);
    installAutoCapturePatches();

    return () => {
      clearAutoCaptureDispatch(dispatch);
      uninstallAutoCapturePatches();
    };
  }, [enabled]);
}

import { useEffect, useRef } from "react";
import { useCopilotKit } from "../context";
import { useCopilotChatConfiguration } from "../providers/CopilotChatConfigurationProvider";
import { useLearnFromUserAction } from "../hooks/use-learn-from-user-action";
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
 * (once, lazily) so that mutating requests are recorded as learn-from-user
 * actions through the same {@link useLearnFromUserAction} pipeline — no
 * per-site instrumentation. Each captured action flows to the runtime's
 * `POST ${runtimeUrl}/annotate` endpoint, the same sink the manual
 * `useLearnFromUserAction` hook uses, so auto-captured and hand-written
 * actions route identically (including the default `["project"]` learning
 * container). The patch is removed when the last consumer unmounts; if
 * auto-capture is never enabled, the globals are never touched.
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
  const learnFromUserAction = useLearnFromUserAction();

  const enabled = config.enabled !== false;

  // The global `fetch` / `XMLHttpRequest` / `navigator.sendBeacon` are patched
  // ONLY when auto-learning is explicitly enabled AND the runtime is
  // Intelligence-backed (i.e. there is an `/annotate` sink to record into).
  // `copilotkit.intelligence` is populated from the runtime-info handshake;
  // `undefined` means Intelligence is not configured. Both conditions are
  // checked before the effect ever reads or reassigns a global, so the
  // default-off and Intelligence-unconfigured paths leave the globals
  // reference-identical to their originals. `useCopilotKit` re-renders this
  // hook when the runtime connection syncs, so a late-arriving `intelligence`
  // still installs the patch (via the effect dependency below).
  const intelligenceConfigured = copilotkit.intelligence !== undefined;

  // Hold the latest inputs in a ref so the bridge dispatcher reads current
  // values without re-installing the patch on every render.
  const latest = useRef({
    config,
    copilotkit,
    chatConfig,
    learnFromUserAction,
  });
  latest.current = { config, copilotkit, chatConfig, learnFromUserAction };
  const warnedRef = useRef(false);

  useEffect(() => {
    // Both conditions must hold before ANY global is read or reassigned.
    if (!enabled || !intelligenceConfigured || typeof window === "undefined") {
      return;
    }

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
          void current.learnFromUserAction(input).catch(() => {
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
  }, [enabled, intelligenceConfigured]);
}

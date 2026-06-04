import type { ReactActivityMessageRenderer } from "../types/react-activity-message-renderer";
import { useEffect, useState } from "react";
import { z } from "zod";

/**
 * Client renderer for the A2UI error-recovery status (OSS-162).
 *
 * The middleware emits an `a2ui_recovery` activity as a pure DATA CONTRACT —
 * `{ status: "retrying" | "failed" | "resolved", attempt?, errors?, attempts?,
 * error? }` — over the AG-UI event stream. This renderer turns that into UX:
 *
 * - "retrying": a non-disruptive, collapsed "Retrying UI generation…" hint that
 *   only appears once it would be perceptible (after `showAfterMs`, or once the
 *   attempt count crosses `showAfterAttempts`) — so a fast first retry never
 *   flashes. It never replaces the surface and never shows noisy errors inline.
 * - "failed": a clean, tasteful hard-failure message for the end user, with the
 *   structured developer detail tucked into an expandable <details>.
 * - "resolved" / anything else: nothing (the A2UI surface renderer shows the UI).
 *
 * Timing + how much debug detail to surface are CLIENT concerns (configurable
 * here), per the team's data-contract decision — the React client stays
 * decoupled from `@ag-ui/a2ui-toolkit`.
 */
export type A2UIRecoveryRendererOptions = {
  /** Delay (ms) before the transient "Retrying…" hint becomes visible. Default 2000. */
  showAfterMs?: number;
  /** Show the hint immediately once `attempt` reaches this value. Default 2. */
  showAfterAttempts?: number;
  /** How much retry/debug detail to surface. Default "collapsed". */
  debugExposure?: "hidden" | "collapsed" | "verbose";
};

const RecoveryContentSchema = z
  .object({
    status: z.enum(["retrying", "failed", "resolved"]).optional(),
    attempt: z.number().optional(),
    maxAttempts: z.number().optional(),
    error: z.string().optional(),
    errors: z.array(z.any()).optional(),
    attempts: z.array(z.any()).optional(),
    // Server-side knob (stamped onto the activity by the A2UI middleware) for how
    // much retry/error detail this renderer surfaces. (OSS-162)
    debugExposure: z.enum(["hidden", "collapsed", "verbose"]).optional(),
  })
  .passthrough();

export function createA2UIRecoveryRenderer(
  options: A2UIRecoveryRendererOptions = {},
): ReactActivityMessageRenderer<any> {
  const showAfterMs = options.showAfterMs ?? 2000;
  const showAfterAttempts = options.showAfterAttempts ?? 2;
  const optionDebugExposure = options.debugExposure ?? "collapsed";

  return {
    activityType: "a2ui_recovery",
    content: RecoveryContentSchema,
    render: ({ content }) => {
      const status = content?.status;
      // Server-configured debugExposure (stamped onto the activity by the A2UI
      // middleware) wins; else the client option; else the "collapsed" default. (OSS-162)
      const debugExposure = content?.debugExposure ?? optionDebugExposure;
      if (status === "failed") {
        return (
          <A2UIRecoveryFailure
            content={content}
            debugExposure={debugExposure}
          />
        );
      }
      if (status === "retrying") {
        return (
          <A2UIRetryingStatus
            content={content}
            showAfterMs={showAfterMs}
            showAfterAttempts={showAfterAttempts}
            debugExposure={debugExposure}
          />
        );
      }
      // "resolved" / unknown → render nothing; the surface renderer owns the UI.
      return null;
    },
  };
}

function A2UIRetryingStatus({
  content,
  showAfterMs,
  showAfterAttempts,
  debugExposure,
}: {
  content: any;
  showAfterMs: number;
  showAfterAttempts: number;
  debugExposure: "hidden" | "collapsed" | "verbose";
}) {
  const attempt =
    typeof content?.attempt === "number" ? content.attempt : undefined;
  const immediate = attempt !== undefined && attempt >= showAfterAttempts;
  const [visible, setVisible] = useState(immediate);

  useEffect(() => {
    if (immediate) {
      setVisible(true);
      return;
    }
    const timer = setTimeout(() => setVisible(true), showAfterMs);
    return () => clearTimeout(timer);
  }, [immediate, showAfterMs]);

  if (!visible) return null;

  const errors = Array.isArray(content?.errors) ? content.errors : [];
  return (
    <div className="cpk:flex cpk:flex-col cpk:gap-1 cpk:rounded-lg cpk:bg-gray-50 cpk:px-3 cpk:py-2 cpk:text-xs cpk:text-gray-500">
      <div className="cpk:flex cpk:items-center cpk:gap-2">
        <span
          className="cpk:h-2 cpk:w-2 cpk:rounded-full cpk:bg-gray-300"
          style={{ animation: "cpk-a2ui-pulse 1.5s ease-in-out infinite" }}
        />
        <span>Retrying UI generation…</span>
      </div>
      {debugExposure !== "hidden" && errors.length > 0 && (
        <A2UIDebugDetails
          label="validation issues"
          open={debugExposure === "verbose"}
          payload={{ attempt: content?.attempt, errors }}
        />
      )}
      <style>{`@keyframes cpk-a2ui-pulse {0%,100%{opacity:.4}50%{opacity:1}}`}</style>
    </div>
  );
}

function A2UIRecoveryFailure({
  content,
  debugExposure,
}: {
  content: any;
  debugExposure: "hidden" | "collapsed" | "verbose";
}) {
  return (
    <div className="cpk:rounded-lg cpk:border cpk:border-amber-200 cpk:bg-amber-50 cpk:p-3 cpk:text-sm cpk:text-amber-800">
      <div className="cpk:font-medium">Couldn't generate the UI</div>
      <div className="cpk:mt-1 cpk:text-xs cpk:text-amber-700">
        Something went wrong rendering this. You can keep chatting and try
        again.
      </div>
      {debugExposure !== "hidden" && (
        <A2UIDebugDetails
          label="developer details"
          open={debugExposure === "verbose"}
          payload={{ error: content?.error, attempts: content?.attempts }}
        />
      )}
    </div>
  );
}

function A2UIDebugDetails({
  label,
  open,
  payload,
}: {
  label: string;
  open: boolean;
  payload: unknown;
}) {
  return (
    <details open={open} className="cpk:mt-2 cpk:text-xs">
      <summary className="cpk:cursor-pointer cpk:text-gray-500">
        {label}
      </summary>
      <pre
        className="cpk:mt-1 cpk:overflow-auto cpk:rounded cpk:bg-gray-100 cpk:p-2 cpk:text-gray-700"
        style={{ fontSize: 11 }}
      >
        {JSON.stringify(payload, null, 2)}
      </pre>
    </details>
  );
}

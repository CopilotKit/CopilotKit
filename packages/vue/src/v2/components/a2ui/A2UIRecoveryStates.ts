import { defineComponent, h, onBeforeUnmount, ref, watch } from "vue";
import type { PropType, VNodeChild } from "vue";
import { z } from "zod";

/**
 * Shared pre-paint lifecycle states for the A2UI surface renderer, ported from
 * React's `A2UIRecoveryStates`.
 *
 * The A2UI middleware drives the WHOLE generative-UI lifecycle on a single
 * `a2ui-surface` activity (one stable messageId, `replace: true`), so the states
 * below swap IN PLACE and the painted surface ultimately replaces them:
 *
 *   building  → animated skeleton + "Building interface" (+ optional ~N tokens)
 *   retrying  → same skeleton; once perceptible, the sub-label becomes
 *               "Retrying generation… (N/M attempts)" (threshold-gated so a fast
 *               transient retry never flashes), with debug detail per debugExposure
 *   failed    → a clean hard-failure card (replacing the skeleton), developer
 *               detail tucked into an expander gated by debugExposure
 *   painted   → the surface renderer owns the UI (these states render nothing)
 *
 * Timing (`showAfterMs` / `showAfterAttempts`) and how much debug detail to
 * surface (`debugExposure`) are client concerns; the server can override
 * `debugExposure` by stamping it onto the activity content (it wins over the
 * client option).
 */
export type A2UIRecoveryRendererOptions = {
  /** Delay (ms) before the "Retrying…" sub-label becomes visible. Default 2000. */
  showAfterMs?: number;
  /** Show the "Retrying…" sub-label immediately once `attempt` reaches this. Default 2. */
  showAfterAttempts?: number;
  /** How much retry/debug detail to surface. Default "collapsed". */
  debugExposure?: "hidden" | "collapsed" | "verbose";
};

export type DebugExposure = "hidden" | "collapsed" | "verbose";

/**
 * The pre-paint lifecycle fields the middleware stamps onto the `a2ui-surface`
 * activity content (alongside `a2ui_operations` on paint).
 */
export const A2UILifecycleFields = {
  status: z.enum(["building", "retrying", "failed"]).optional(),
  attempt: z.number().optional(),
  maxAttempts: z.number().optional(),
  progressTokens: z.number().optional(),
  error: z.string().optional(),
  errors: z.array(z.any()).optional(),
  attempts: z.array(z.any()).optional(),
  // Server-side knob (stamped by the A2UI middleware).
  debugExposure: z.enum(["hidden", "collapsed", "verbose"]).optional(),
};

/** Server-stamped debugExposure wins; else the client option. */
export function resolveDebugExposure(
  content: any,
  optionDebugExposure: DebugExposure,
): DebugExposure {
  return content?.debugExposure ?? optionDebugExposure;
}

const tokensOf = (content: any): number | undefined =>
  typeof content?.progressTokens === "number"
    ? content.progressTokens
    : undefined;

// --- Skeleton + primitives ---------------------------------------------------

const dot = () =>
  h("div", {
    style: {
      width: "7px",
      height: "7px",
      borderRadius: "50%",
      backgroundColor: "#d4d4d8",
      flexShrink: 0,
    },
  });

const spacer = () => h("div", { style: { width: "12px" } });

const bar = (
  w: number,
  ht: number,
  bg: string,
  anim?: number,
  opacity?: number,
  transition?: string,
) =>
  h("div", {
    style: {
      width: `${w}px`,
      height: `${ht}px`,
      borderRadius: "9999px",
      backgroundColor: bg,
      ...(anim !== undefined
        ? {
            animation: `cpk-a2ui-fade 2.4s ease-in-out ${anim}s infinite`,
          }
        : {}),
      ...(opacity !== undefined ? { opacity } : {}),
      ...(transition ? { transition } : {}),
    },
  });

const row = (show: boolean, delay: number, children: VNodeChild[]) =>
  h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        opacity: show ? 1 : 0,
        transition: `opacity 0.4s ${delay}s`,
      },
    },
    children,
  );

/**
 * Animated wireframe skeleton with a label, an optional live token count, and
 * optional debug detail below it. The `tokens` count drives a progressive
 * reveal of skeleton rows.
 */
export function renderA2UIGeneratingSkeleton(
  label: string,
  tokens?: number,
  children?: VNodeChild[],
): VNodeChild {
  // No count yet → show the fuller skeleton rather than an empty box.
  const phase =
    tokens == null
      ? 3
      : tokens < 50
        ? 0
        : tokens < 200
          ? 1
          : tokens < 400
            ? 2
            : 3;

  return h("div", { style: { margin: "12px 0", maxWidth: "320px" } }, [
    h(
      "div",
      {
        style: {
          position: "relative",
          overflow: "hidden",
          borderRadius: "12px",
          border: "1px solid rgba(228,228,231,0.8)",
          backgroundColor: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          padding: "16px 18px 14px",
        },
      },
      [
        // Top bar
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "12px",
            },
          },
          [
            h("div", { style: { display: "flex", gap: "4px" } }, [
              dot(),
              dot(),
              dot(),
            ]),
            bar(
              64,
              6,
              "#e4e4e7",
              undefined,
              phase >= 1 ? 1 : 0.4,
              "opacity 0.5s",
            ),
          ],
        ),
        // Skeleton lines
        h("div", { style: { display: "grid", gap: "7px" } }, [
          row(phase >= 0, 0, [
            bar(36, 7, "rgba(147,197,253,0.7)", 0),
            bar(80, 7, "rgba(219,234,254,0.8)", 0.2),
          ]),
          row(phase >= 0, 0.1, [
            spacer(),
            dot(),
            bar(100, 7, "rgba(24,24,27,0.2)", 0.3),
          ]),
          row(phase >= 1, 0.15, [
            spacer(),
            bar(48, 7, "rgba(24,24,27,0.15)", 0.1),
            bar(40, 7, "rgba(153,246,228,0.6)", 0.5),
            bar(56, 7, "rgba(147,197,253,0.6)", 0.3),
          ]),
          row(phase >= 1, 0.2, [
            spacer(),
            dot(),
            bar(60, 7, "rgba(24,24,27,0.15)", 0.4),
          ]),
          row(phase >= 2, 0.25, [
            bar(40, 7, "rgba(153,246,228,0.5)", 0.2),
            dot(),
            bar(48, 7, "rgba(24,24,27,0.15)", 0.6),
            bar(64, 7, "rgba(147,197,253,0.5)", 0.1),
          ]),
          row(phase >= 2, 0.3, [
            bar(36, 7, "rgba(147,197,253,0.6)", 0.5),
            bar(36, 7, "rgba(24,24,27,0.12)", 0.7),
          ]),
          row(phase >= 3, 0.35, [
            dot(),
            bar(44, 7, "rgba(24,24,27,0.18)", 0.3),
            dot(),
            bar(56, 7, "rgba(153,246,228,0.5)", 0.8),
            bar(48, 7, "rgba(147,197,253,0.5)", 0.4),
          ]),
        ]),
        // Shimmer
        h("div", {
          style: {
            pointerEvents: "none",
            position: "absolute",
            inset: "0",
            background:
              "linear-gradient(105deg, transparent 0%, transparent 40%, rgba(255,255,255,0.6) 50%, transparent 60%, transparent 100%)",
            backgroundSize: "250% 100%",
            animation: "cpk-a2ui-sweep 3s ease-in-out infinite",
          },
        }),
      ],
    ),
    // Label
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          marginTop: "8px",
        },
      },
      [
        h(
          "span",
          {
            style: {
              fontSize: "12px",
              color: "#a1a1aa",
              letterSpacing: "0.025em",
            },
          },
          label,
        ),
        ...(typeof tokens === "number" && tokens > 0
          ? [
              h(
                "span",
                {
                  style: {
                    fontSize: "11px",
                    color: "#d4d4d8",
                    fontVariantNumeric: "tabular-nums",
                  },
                },
                `~${tokens.toLocaleString()} tokens`,
              ),
            ]
          : []),
      ],
    ),
    ...(children ?? []),
    // Keyframe styles
    h(
      "style",
      `
    @keyframes cpk-a2ui-fade {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    @keyframes cpk-a2ui-sweep {
      0% { background-position: 250% 0; }
      100% { background-position: -250% 0; }
    }
  `,
    ),
  ]);
}

function renderDebugDetails(
  label: string,
  open: boolean,
  payload: unknown,
): VNodeChild {
  return h("details", { open, class: "cpk-a2ui-debug-details" }, [
    h("summary", { class: "cpk-a2ui-debug-details-summary" }, label),
    h(
      "pre",
      { class: "cpk-a2ui-debug-details-payload", style: { fontSize: "11px" } },
      JSON.stringify(payload, null, 2),
    ),
  ]);
}

// --- Lifecycle states ---------------------------------------------------------

/** building: the generic skeleton + optional live token count. */
export const A2UIBuildingState = defineComponent({
  name: "A2UIBuildingState",
  props: {
    content: { type: null as unknown as PropType<any>, default: undefined },
  },
  setup(props) {
    return () =>
      renderA2UIGeneratingSkeleton(
        "Building interface",
        tokensOf(props.content),
      );
  },
});

/**
 * retrying: stays the generic skeleton through fast/transient retries; only
 * once the retry is perceptible (after `showAfterMs`, or once `attempt`
 * crosses `showAfterAttempts`) does the sub-label reveal
 * "Retrying generation… (N/M)".
 */
export const A2UIRetryingState = defineComponent({
  name: "A2UIRetryingState",
  props: {
    content: { type: null as unknown as PropType<any>, default: undefined },
    showAfterMs: { type: Number, required: true },
    showAfterAttempts: { type: Number, required: true },
    debugExposure: {
      type: String as PropType<DebugExposure>,
      required: true,
    },
  },
  setup(props) {
    const attempt = () =>
      typeof props.content?.attempt === "number"
        ? (props.content.attempt as number)
        : undefined;
    const immediate = () => {
      const current = attempt();
      return current !== undefined && current >= props.showAfterAttempts;
    };
    const revealed = ref(immediate());
    let timer: ReturnType<typeof setTimeout> | undefined;

    watch(
      [immediate, () => props.showAfterMs],
      ([isImmediate, showAfterMs]) => {
        clearTimeout(timer);
        if (isImmediate) {
          revealed.value = true;
          return;
        }
        timer = setTimeout(() => {
          revealed.value = true;
        }, showAfterMs);
      },
      { immediate: true },
    );
    onBeforeUnmount(() => clearTimeout(timer));

    return () => {
      const tokens = tokensOf(props.content);
      // Not yet perceptible → indistinguishable from normal building.
      if (!revealed.value) {
        return renderA2UIGeneratingSkeleton("Building interface", tokens);
      }
      const current = attempt();
      const maxAttempts =
        typeof props.content?.maxAttempts === "number"
          ? props.content.maxAttempts
          : undefined;
      const label =
        current !== undefined && maxAttempts !== undefined
          ? `Retrying generation… (${current}/${maxAttempts} attempts)`
          : "Retrying generation…";
      const errors = Array.isArray(props.content?.errors)
        ? props.content.errors
        : [];
      return renderA2UIGeneratingSkeleton(
        label,
        tokens,
        props.debugExposure !== "hidden" && errors.length > 0
          ? [
              renderDebugDetails(
                "validation issues",
                props.debugExposure === "verbose",
                { attempt: props.content?.attempt, errors },
              ),
            ]
          : [],
      );
    };
  },
});

/** failed: a clean hard-failure card that replaces the skeleton in place. */
export const A2UIRecoveryFailure = defineComponent({
  name: "A2UIRecoveryFailure",
  props: {
    content: { type: null as unknown as PropType<any>, default: undefined },
    debugExposure: {
      type: String as PropType<DebugExposure>,
      required: true,
    },
  },
  setup(props) {
    return () =>
      h("div", { class: "cpk-a2ui-recovery-failure" }, [
        h(
          "div",
          { class: "cpk-a2ui-recovery-failure-title" },
          "Couldn't generate the UI",
        ),
        h(
          "div",
          { class: "cpk-a2ui-recovery-failure-description" },
          "Something went wrong rendering this. You can keep chatting and try again.",
        ),
        props.debugExposure !== "hidden"
          ? renderDebugDetails(
              "developer details",
              props.debugExposure === "verbose",
              {
                error: props.content?.error,
                attempts: props.content?.attempts,
              },
            )
          : null,
      ]);
  },
});

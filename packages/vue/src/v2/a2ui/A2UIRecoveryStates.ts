import { defineComponent, h, onUnmounted, ref, watch } from "vue";
import type { PropType } from "vue";
import { z } from "zod";

export type A2UIRecoveryRendererOptions = {
  showAfterMs?: number;
  showAfterAttempts?: number;
  debugExposure?: "hidden" | "collapsed" | "verbose";
};

export type DebugExposure = "hidden" | "collapsed" | "verbose";

export const A2UILifecycleFields = {
  status: z.enum(["building", "retrying", "failed"]).optional(),
  attempt: z.number().optional(),
  maxAttempts: z.number().optional(),
  progressTokens: z.number().optional(),
  error: z.string().optional(),
  errors: z.array(z.any()).optional(),
  attempts: z.array(z.any()).optional(),
  debugExposure: z.enum(["hidden", "collapsed", "verbose"]).optional(),
};

export function resolveDebugExposure(
  content: any,
  optionDebugExposure: DebugExposure,
): DebugExposure {
  return content?.debugExposure ?? optionDebugExposure;
}

function Dot() {
  return h("div", {
    style: {
      width: "7px",
      height: "7px",
      borderRadius: "50%",
      backgroundColor: "#d4d4d8",
      flexShrink: 0,
    },
  });
}

function Spacer() {
  return h("div", { style: { width: "12px" } });
}

function Bar(props: {
  w: number;
  h: number;
  bg: string;
  anim?: number;
  opacity?: number;
  transition?: string;
}) {
  return h("div", {
    style: {
      width: `${props.w}px`,
      height: `${props.h}px`,
      borderRadius: "9999px",
      backgroundColor: props.bg,
      ...(props.anim !== undefined
        ? {
            animation: `cpk-a2ui-fade 2.4s ease-in-out ${props.anim}s infinite`,
          }
        : {}),
      ...(props.opacity !== undefined ? { opacity: props.opacity } : {}),
      ...(props.transition ? { transition: props.transition } : {}),
    },
  });
}

function Row(props: { show: boolean; delay?: number; children: unknown }) {
  return h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        opacity: props.show ? 1 : 0,
        transition: `opacity 0.4s ${props.delay ?? 0}s`,
      },
    },
    props.children as any,
  );
}

export const A2UIDebugDetails = defineComponent({
  name: "A2UIDebugDetails",
  props: {
    label: { type: String, required: true },
    open: { type: Boolean, required: true },
    payload: { type: null as unknown as PropType<unknown>, required: true },
  },
  setup(props) {
    return () =>
      h("details", { open: props.open, class: "cpk:mt-2 cpk:text-xs" }, [
        h(
          "summary",
          { class: "cpk:cursor-pointer cpk:text-gray-500" },
          props.label,
        ),
        h(
          "pre",
          {
            class:
              "cpk:mt-1 cpk:overflow-auto cpk:rounded cpk:bg-gray-100 cpk:p-2 cpk:text-gray-700",
            style: { fontSize: "11px" },
          },
          JSON.stringify(props.payload, null, 2),
        ),
      ]);
  },
});

export const A2UIGeneratingSkeleton = defineComponent({
  name: "A2UIGeneratingSkeleton",
  props: {
    label: { type: String, required: true },
    tokens: { type: Number, required: false },
  },
  setup(props, { slots }) {
    const phase = () => {
      const tokens = props.tokens;
      if (tokens == null) return 3;
      if (tokens < 50) return 0;
      if (tokens < 200) return 1;
      if (tokens < 400) return 2;
      return 3;
    };

    return () => {
      const p = phase();
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
                  Dot(),
                  Dot(),
                  Dot(),
                ]),
                Bar({
                  w: 64,
                  h: 6,
                  bg: "#e4e4e7",
                  opacity: p >= 1 ? 1 : 0.4,
                  transition: "opacity 0.5s",
                }),
              ],
            ),
            h("div", { style: { display: "grid", gap: "7px" } }, [
              Row({
                show: p >= 0,
                delay: 0,
                children: [
                  Bar({ w: 36, h: 7, bg: "rgba(147,197,253,0.7)", anim: 0 }),
                  Bar({
                    w: 80,
                    h: 7,
                    bg: "rgba(219,234,254,0.8)",
                    anim: 0.2,
                  }),
                ],
              }),
              Row({
                show: p >= 0,
                delay: 0.1,
                children: [
                  Spacer(),
                  Dot(),
                  Bar({ w: 100, h: 7, bg: "rgba(24,24,27,0.2)", anim: 0.3 }),
                ],
              }),
              Row({
                show: p >= 1,
                delay: 0.15,
                children: [
                  Spacer(),
                  Bar({
                    w: 48,
                    h: 7,
                    bg: "rgba(24,24,27,0.15)",
                    anim: 0.1,
                  }),
                  Bar({
                    w: 40,
                    h: 7,
                    bg: "rgba(153,246,228,0.6)",
                    anim: 0.5,
                  }),
                  Bar({
                    w: 56,
                    h: 7,
                    bg: "rgba(147,197,253,0.6)",
                    anim: 0.3,
                  }),
                ],
              }),
              Row({
                show: p >= 1,
                delay: 0.2,
                children: [
                  Spacer(),
                  Dot(),
                  Bar({
                    w: 60,
                    h: 7,
                    bg: "rgba(24,24,27,0.15)",
                    anim: 0.4,
                  }),
                ],
              }),
              Row({
                show: p >= 2,
                delay: 0.25,
                children: [
                  Bar({
                    w: 40,
                    h: 7,
                    bg: "rgba(153,246,228,0.5)",
                    anim: 0.2,
                  }),
                  Dot(),
                  Bar({
                    w: 48,
                    h: 7,
                    bg: "rgba(24,24,27,0.15)",
                    anim: 0.6,
                  }),
                  Bar({
                    w: 64,
                    h: 7,
                    bg: "rgba(147,197,253,0.5)",
                    anim: 0.1,
                  }),
                ],
              }),
              Row({
                show: p >= 2,
                delay: 0.3,
                children: [
                  Bar({
                    w: 36,
                    h: 7,
                    bg: "rgba(147,197,253,0.6)",
                    anim: 0.5,
                  }),
                  Bar({
                    w: 36,
                    h: 7,
                    bg: "rgba(24,24,27,0.12)",
                    anim: 0.7,
                  }),
                ],
              }),
              Row({
                show: p >= 3,
                delay: 0.35,
                children: [
                  Dot(),
                  Bar({
                    w: 44,
                    h: 7,
                    bg: "rgba(24,24,27,0.18)",
                    anim: 0.3,
                  }),
                  Dot(),
                  Bar({
                    w: 56,
                    h: 7,
                    bg: "rgba(153,246,228,0.5)",
                    anim: 0.8,
                  }),
                  Bar({
                    w: 48,
                    h: 7,
                    bg: "rgba(147,197,253,0.5)",
                    anim: 0.4,
                  }),
                ],
              }),
            ]),
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
              props.label,
            ),
            ...(typeof props.tokens === "number" && props.tokens > 0
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
                    `~${props.tokens.toLocaleString()} tokens`,
                  ),
                ]
              : []),
          ],
        ),
        slots.default?.(),
        h(
          "style",
          {},
          `@keyframes cpk-a2ui-fade {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
@keyframes cpk-a2ui-sweep {
  0% { background-position: 250% 0; }
  100% { background-position: -250% 0; }
}`,
        ),
      ]);
    };
  },
});

export const A2UIBuildingState = defineComponent({
  name: "A2UIBuildingState",
  props: {
    content: { type: Object as PropType<any>, required: true },
  },
  setup(props) {
    return () => {
      const tokens =
        typeof props.content?.progressTokens === "number"
          ? props.content.progressTokens
          : undefined;
      return h(A2UIGeneratingSkeleton, {
        label: "Building interface",
        tokens,
      });
    };
  },
});

export const A2UIRetryingState = defineComponent({
  name: "A2UIRetryingState",
  props: {
    content: { type: Object as PropType<any>, required: true },
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
        ? props.content.attempt
        : undefined;
    const maxAttempts = () =>
      typeof props.content?.maxAttempts === "number"
        ? props.content.maxAttempts
        : undefined;
    const immediate = () => {
      const a = attempt();
      return a !== undefined && a >= props.showAfterAttempts;
    };
    const revealed = ref(immediate());
    let timer: ReturnType<typeof setTimeout> | null = null;

    watch(
      () => [immediate(), props.showAfterMs] as const,
      ([isImmediate, ms]) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (isImmediate) {
          revealed.value = true;
          return;
        }
        timer = setTimeout(() => {
          revealed.value = true;
        }, ms);
      },
      { immediate: true },
    );

    onUnmounted(() => {
      if (timer) clearTimeout(timer);
    });

    return () => {
      const tokens =
        typeof props.content?.progressTokens === "number"
          ? props.content.progressTokens
          : undefined;

      if (!revealed.value) {
        return h(A2UIGeneratingSkeleton, {
          label: "Building interface",
          tokens,
        });
      }

      const a = attempt();
      const m = maxAttempts();
      const label =
        a !== undefined && m !== undefined
          ? `Retrying generation… (${a}/${m} attempts)`
          : "Retrying generation…";
      const errors = Array.isArray(props.content?.errors)
        ? props.content.errors
        : [];

      return h(A2UIGeneratingSkeleton, { label, tokens }, () =>
        props.debugExposure !== "hidden" && errors.length > 0
          ? h(A2UIDebugDetails, {
              label: "validation issues",
              open: props.debugExposure === "verbose",
              payload: { attempt: props.content?.attempt, errors },
            })
          : null,
      );
    };
  },
});

export const A2UIRecoveryFailure = defineComponent({
  name: "A2UIRecoveryFailure",
  props: {
    content: { type: Object as PropType<any>, required: true },
    debugExposure: {
      type: String as PropType<DebugExposure>,
      required: true,
    },
  },
  setup(props) {
    return () =>
      h(
        "div",
        {
          class:
            "cpk:rounded-lg cpk:border cpk:border-amber-200 cpk:bg-amber-50 cpk:p-3 cpk:text-sm cpk:text-amber-800",
        },
        [
          h("div", { class: "cpk:font-medium" }, "Couldn't generate the UI"),
          h(
            "div",
            { class: "cpk:mt-1 cpk:text-xs cpk:text-amber-700" },
            "Something went wrong rendering this. You can keep chatting and try again.",
          ),
          props.debugExposure !== "hidden"
            ? h(A2UIDebugDetails, {
                label: "developer details",
                open: props.debugExposure === "verbose",
                payload: {
                  error: props.content?.error,
                  attempts: props.content?.attempts,
                },
              })
            : null,
        ],
      );
  },
});

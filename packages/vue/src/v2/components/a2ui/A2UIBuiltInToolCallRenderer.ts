import { h, watch, type VNodeChild } from "vue";
import type { ShallowRef } from "vue";
import { z } from "zod";
import type { ToolCallStatus } from "@copilotkit/core";
import type { CopilotKitCoreVue } from "../../lib/vue-core";
import { defineToolCallRenderer } from "../../types/defineToolCallRenderer";

/**
 * Tool name used by the dynamic A2UI generation secondary LLM.
 * This renderer is auto-registered when A2UI is enabled.
 */
export const RENDER_A2UI_TOOL_NAME = "render_a2ui";

/**
 * Registers the built-in `render_a2ui` tool call renderer via the props-based
 * `setRenderToolCalls` mechanism (not `useRenderTool`).
 *
 * This ensures user-registered `useRenderTool({ name: "render_a2ui", ... })`
 * hooks automatically override the built-in, since the merge logic in
 * vue-core.ts gives hook-based entries priority over prop-based entries.
 *
 * Call from the provider's setup function and pass a cleanup callback.
 */
export function registerA2UIBuiltInToolCallRenderer(
  copilotkit: ShallowRef<CopilotKitCoreVue>,
  enabled: () => boolean,
): void {
  watch(
    [() => copilotkit.value, enabled],
    ([core, isEnabled], _prev, onCleanup) => {
      if (!isEnabled) return;

      const renderer = defineToolCallRenderer({
        name: RENDER_A2UI_TOOL_NAME,
        args: z.any(),
        render: ({
          status,
          args: parameters,
        }: {
          status: ToolCallStatus;
          args: unknown;
          [key: string]: unknown;
        }): VNodeChild => {
          if (status === "complete") return null;
          const params = parameters as Record<string, unknown>;
          // Hide skeleton once the A2UI surface has enough data to render.
          const items = params?.items;
          if (Array.isArray(items) && items.length > 0) return null;
          const components = params?.components;
          if (Array.isArray(components) && components.length > 2) return null;
          return renderA2UIProgressIndicator(parameters);
        },
      });

      // Register via props-based mechanism so useRenderTool hooks take priority
      const existing = core.propRenderToolCalls;
      core.setRenderToolCalls([
        ...existing.filter((rc) => rc.name !== RENDER_A2UI_TOOL_NAME),
        renderer,
      ]);

      onCleanup(() => {
        const current = core.propRenderToolCalls;
        core.setRenderToolCalls(
          current.filter((rc) => rc.name !== RENDER_A2UI_TOOL_NAME),
        );
        progressState.clear();
      });
    },
    { immediate: true },
  );
}

/**
 * Vue render-function equivalent of the React A2UIProgressIndicator.
 * Shows a skeleton wireframe that progressively reveals as tokens stream in.
 */
const progressState = new Map<
  string,
  { lastTime: number; lastTokens: number }
>();

function renderA2UIProgressIndicator(parameters: unknown): VNodeChild {
  const params = parameters as Record<string, unknown> | null | undefined;
  const key = typeof params?.name === "string" ? params.name : "__default__";
  let state = progressState.get(key);
  if (!state) {
    state = { lastTime: 0, lastTokens: 0 };
    progressState.set(key, state);
  }

  const now = Date.now();
  let tokens = state.lastTokens;
  if (now - state.lastTime > 200) {
    const chars = JSON.stringify(parameters ?? {}).length;
    tokens = Math.round(chars / 4);
    state.lastTime = now;
    state.lastTokens = tokens;
  }

  const phase = tokens < 50 ? 0 : tokens < 200 ? 1 : tokens < 400 ? 2 : 3;

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
          "Building interface",
        ),
        ...(tokens > 0
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

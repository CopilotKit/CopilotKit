import { h } from "vue";
import type { Component, VNodeChild } from "vue";
import { ɵA2UI_LIFECYCLE_TEXT, ɵA2UI_SKELETON_ROWS } from "@copilotkit/core";
import type {
  ɵA2UIActivitySnapshot,
  ɵA2UIProgressPhase,
  ɵA2UIRecoveryOptions,
  ɵA2UISkeletonPart,
} from "@copilotkit/core";

/**
 * Pre-paint recovery and loading options: how long before the "Retrying…"
 * label appears, and how much retry and debug detail to show. Core's
 * `ɵA2UIActivityController` owns the rules; this module only draws its
 * snapshot.
 */
export type A2UIRecoveryRendererOptions = ɵA2UIRecoveryOptions;

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

function skeletonPart(part: ɵA2UISkeletonPart) {
  if (part === "dot") return dot();
  if (part === "spacer") return h("div", { style: { width: "12px" } });
  return h("div", {
    style: {
      width: `${String(part.w)}px`,
      height: "7px",
      borderRadius: "9999px",
      backgroundColor: part.bg,
      animation: `cpk-a2ui-fade 2.4s ease-in-out ${String(part.anim)}s infinite`,
    },
  });
}

/**
 * Animated wireframe skeleton with a label, an optional live token count, and
 * optional debug detail below it. `phase` reveals the rows.
 */
function renderA2UIGeneratingSkeleton(
  label: string,
  tokens: number | undefined,
  phase: ɵA2UIProgressPhase,
  children: VNodeChild[],
) {
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
              dot(),
              dot(),
              dot(),
            ]),
            h("div", {
              style: {
                width: "64px",
                height: "6px",
                borderRadius: "9999px",
                backgroundColor: "#e4e4e7",
                opacity: phase >= 1 ? 1 : 0.4,
                transition: "opacity 0.5s",
              },
            }),
          ],
        ),
        h(
          "div",
          { style: { display: "grid", gap: "7px" } },
          ɵA2UI_SKELETON_ROWS.map((row) =>
            h(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  opacity: phase >= row.phase ? 1 : 0,
                  transition: `opacity 0.4s ${String(row.delay)}s`,
                },
              },
              row.parts.map(skeletonPart),
            ),
          ),
        ),
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
          label,
        ),
        typeof tokens === "number" && tokens > 0
          ? h(
              "span",
              {
                style: {
                  fontSize: "11px",
                  color: "#d4d4d8",
                  fontVariantNumeric: "tabular-nums",
                },
              },
              `~${tokens.toLocaleString()} tokens`,
            )
          : null,
      ],
    ),
    ...children,
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

/**
 * Draws the lifecycle state of an `a2ui-surface` activity: the failure card,
 * the host's loading component while building, or the skeleton.
 *
 * @param snapshot - The activity controller's snapshot.
 * @param loadingComponent - Shown instead of the skeleton while building.
 */
export function renderA2UILifecycleState(
  snapshot: ɵA2UIActivitySnapshot,
  loadingComponent: Component | undefined,
) {
  const details: VNodeChild[] = snapshot.showDebugDetails
    ? [
        h(
          "details",
          { open: snapshot.debugDetailsOpen, class: "cpk-a2ui-debug-details" },
          [
            h(
              "summary",
              { class: "cpk-a2ui-debug-details-summary" },
              snapshot.debugDetailsLabel,
            ),
            h(
              "pre",
              {
                class: "cpk-a2ui-debug-details-payload",
                style: { fontSize: "11px" },
              },
              snapshot.debugPayload,
            ),
          ],
        ),
      ]
    : [];
  const { lifecycle } = snapshot;

  if (lifecycle.status === "failed") {
    return h("div", { class: "cpk-a2ui-recovery-failure" }, [
      h(
        "div",
        { class: "cpk-a2ui-recovery-failure-title" },
        ɵA2UI_LIFECYCLE_TEXT.failureTitle,
      ),
      h(
        "div",
        { class: "cpk-a2ui-recovery-failure-description" },
        ɵA2UI_LIFECYCLE_TEXT.failureDescription,
      ),
      ...details,
    ]);
  }
  if (lifecycle.status === "building" && loadingComponent) {
    return h(loadingComponent);
  }
  return renderA2UIGeneratingSkeleton(
    snapshot.label,
    lifecycle.progressTokens,
    snapshot.progressPhase,
    details,
  );
}

"use client";
import React from "react";
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
 * `ɵA2UIActivityController` owns the rules; these components only draw its
 * snapshot.
 */
export type A2UIRecoveryRendererOptions = ɵA2UIRecoveryOptions;

/**
 * Draws the lifecycle state of an `a2ui-surface` activity: the failure card,
 * the host's loading component while building, or the skeleton.
 */
export function A2UILifecycleState({
  snapshot,
  loadingComponent: LoadingComponent,
}: {
  snapshot: ɵA2UIActivitySnapshot;
  loadingComponent?: React.ComponentType;
}) {
  const { lifecycle } = snapshot;
  const details = snapshot.showDebugDetails ? (
    <A2UIDebugDetails
      label={snapshot.debugDetailsLabel}
      open={snapshot.debugDetailsOpen}
      payload={snapshot.debugPayload}
    />
  ) : null;

  if (lifecycle.status === "failed") {
    return (
      <div className="cpk-a2ui-recovery-failure">
        <div className="cpk-a2ui-recovery-failure-title">
          {ɵA2UI_LIFECYCLE_TEXT.failureTitle}
        </div>
        <div className="cpk-a2ui-recovery-failure-description">
          {ɵA2UI_LIFECYCLE_TEXT.failureDescription}
        </div>
        {details}
      </div>
    );
  }
  if (lifecycle.status === "building" && LoadingComponent) {
    return <LoadingComponent />;
  }
  return (
    <A2UIGeneratingSkeleton
      label={snapshot.label}
      tokens={lifecycle.progressTokens}
      phase={snapshot.progressPhase}
    >
      {details}
    </A2UIGeneratingSkeleton>
  );
}

/**
 * Animated wireframe skeleton with a label, an optional live token count, and
 * an optional debug-detail slot below it. `phase` reveals the rows.
 */
export function A2UIGeneratingSkeleton({
  label,
  tokens,
  phase,
  children,
}: {
  label: string;
  tokens?: number;
  phase: ɵA2UIProgressPhase;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ margin: "12px 0", maxWidth: 320 }}>
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 12,
          border: "1px solid rgba(228,228,231,0.8)",
          backgroundColor: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          padding: "16px 18px 14px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", gap: 4 }}>
            <Dot />
            <Dot />
            <Dot />
          </div>
          <div
            style={{
              width: 64,
              height: 6,
              borderRadius: 9999,
              backgroundColor: "#e4e4e7",
              opacity: phase >= 1 ? 1 : 0.4,
              transition: "opacity 0.5s",
            }}
          />
        </div>

        <div style={{ display: "grid", gap: 7 }}>
          {ɵA2UI_SKELETON_ROWS.map((row, rowIndex) => (
            <div
              key={rowIndex}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                opacity: phase >= row.phase ? 1 : 0,
                transition: `opacity 0.4s ${String(row.delay)}s`,
              }}
            >
              {row.parts.map((part, partIndex) => (
                <SkeletonPart key={partIndex} part={part} />
              ))}
            </div>
          ))}
        </div>

        <div
          style={{
            pointerEvents: "none",
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(105deg, transparent 0%, transparent 40%, rgba(255,255,255,0.6) 50%, transparent 60%, transparent 100%)",
            backgroundSize: "250% 100%",
            animation: "cpk-a2ui-sweep 3s ease-in-out infinite",
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          marginTop: 8,
        }}
      >
        <span
          style={{ fontSize: 12, color: "#a1a1aa", letterSpacing: "0.025em" }}
        >
          {label}
        </span>
        {typeof tokens === "number" && tokens > 0 && (
          <span
            style={{
              fontSize: 11,
              color: "#d4d4d8",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            ~{tokens.toLocaleString()} tokens
          </span>
        )}
      </div>

      {children}

      <style>{`
        @keyframes cpk-a2ui-fade {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes cpk-a2ui-sweep {
          0% { background-position: 250% 0; }
          100% { background-position: -250% 0; }
        }
      `}</style>
    </div>
  );
}

export function A2UIDebugDetails({
  label,
  open,
  payload,
}: {
  label: string;
  open: boolean;
  payload: string;
}) {
  return (
    <details open={open} className="cpk-a2ui-debug-details">
      <summary className="cpk-a2ui-debug-details-summary">{label}</summary>
      <pre className="cpk-a2ui-debug-details-payload" style={{ fontSize: 11 }}>
        {payload}
      </pre>
    </details>
  );
}

function Dot() {
  return (
    <div
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        backgroundColor: "#d4d4d8",
        flexShrink: 0,
      }}
    />
  );
}

function SkeletonPart({ part }: { part: ɵA2UISkeletonPart }) {
  if (part === "dot") return <Dot />;
  if (part === "spacer") return <div style={{ width: 12 }} />;
  return (
    <div
      style={{
        width: part.w,
        height: 7,
        borderRadius: 9999,
        backgroundColor: part.bg,
        animation: `cpk-a2ui-fade 2.4s ease-in-out ${String(part.anim)}s infinite`,
      }}
    />
  );
}

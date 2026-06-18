"use client";
import React, { useEffect, useState } from "react";
import { z } from "zod";

/**
 * Shared pre-paint lifecycle states for the A2UI surface renderer (OSS-162).
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
 * Timing (`showAfterMs` / `showAfterAttempts`) and how much debug detail to surface
 * (`debugExposure`) are client concerns; the server can override `debugExposure`
 * by stamping it onto the activity content (it wins over the client option).
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
 * activity content (alongside `a2ui_operations` on paint). `.passthrough()` keeps
 * `a2ui_operations` and any future fields intact.
 */
export const A2UILifecycleFields = {
  status: z.enum(["building", "retrying", "failed"]).optional(),
  attempt: z.number().optional(),
  maxAttempts: z.number().optional(),
  progressTokens: z.number().optional(),
  error: z.string().optional(),
  errors: z.array(z.any()).optional(),
  attempts: z.array(z.any()).optional(),
  // Server-side knob (stamped by the A2UI middleware): "hidden" | "collapsed" | "verbose".
  debugExposure: z.enum(["hidden", "collapsed", "verbose"]).optional(),
};

/** Server-stamped debugExposure wins; else the client option; else "collapsed". */
export function resolveDebugExposure(
  content: any,
  optionDebugExposure: DebugExposure,
): DebugExposure {
  return content?.debugExposure ?? optionDebugExposure;
}

// --- Lifecycle states ---------------------------------------------------------

/** building: the generic skeleton + optional live token count. */
export function A2UIBuildingState({ content }: { content: any }) {
  const tokens =
    typeof content?.progressTokens === "number"
      ? content.progressTokens
      : undefined;
  return <A2UIGeneratingSkeleton label="Building interface" tokens={tokens} />;
}

/**
 * retrying: stays the generic skeleton through fast/transient retries; only once
 * the retry is perceptible (after `showAfterMs`, or once `attempt` crosses
 * `showAfterAttempts`) does the sub-label reveal "Retrying generation… (N/M)".
 */
export function A2UIRetryingState({
  content,
  showAfterMs,
  showAfterAttempts,
  debugExposure,
}: {
  content: any;
  showAfterMs: number;
  showAfterAttempts: number;
  debugExposure: DebugExposure;
}) {
  const attempt =
    typeof content?.attempt === "number" ? content.attempt : undefined;
  const maxAttempts =
    typeof content?.maxAttempts === "number" ? content.maxAttempts : undefined;
  const immediate = attempt !== undefined && attempt >= showAfterAttempts;
  const [revealed, setRevealed] = useState(immediate);

  useEffect(() => {
    if (immediate) {
      setRevealed(true);
      return;
    }
    const timer = setTimeout(() => setRevealed(true), showAfterMs);
    return () => clearTimeout(timer);
  }, [immediate, showAfterMs]);

  const tokens =
    typeof content?.progressTokens === "number"
      ? content.progressTokens
      : undefined;

  // Not yet perceptible → indistinguishable from normal building.
  if (!revealed) {
    return (
      <A2UIGeneratingSkeleton label="Building interface" tokens={tokens} />
    );
  }

  const label =
    attempt !== undefined && maxAttempts !== undefined
      ? `Retrying generation… (${attempt}/${maxAttempts} attempts)`
      : "Retrying generation…";
  const errors = Array.isArray(content?.errors) ? content.errors : [];

  return (
    <A2UIGeneratingSkeleton label={label} tokens={tokens}>
      {debugExposure !== "hidden" && errors.length > 0 && (
        <A2UIDebugDetails
          label="validation issues"
          open={debugExposure === "verbose"}
          payload={{ attempt: content?.attempt, errors }}
        />
      )}
    </A2UIGeneratingSkeleton>
  );
}

/** failed: a clean hard-failure card that replaces the skeleton in place. */
export function A2UIRecoveryFailure({
  content,
  debugExposure,
}: {
  content: any;
  debugExposure: DebugExposure;
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

// --- Skeleton + primitives (ported from the retired render_a2ui renderer) -----

/**
 * Animated wireframe skeleton with a label, an optional live token count, and an
 * optional debug-detail slot below it. Pure CSS animation (no data dependency).
 * The `tokens` count drives a progressive reveal of skeleton rows.
 */
export function A2UIGeneratingSkeleton({
  label,
  tokens,
  children,
}: {
  label: string;
  tokens?: number;
  children?: React.ReactNode;
}) {
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
        {/* Top bar */}
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
          <Bar
            w={64}
            h={6}
            bg="#e4e4e7"
            opacity={phase >= 1 ? 1 : 0.4}
            transition="opacity 0.5s"
          />
        </div>

        {/* Skeleton lines */}
        <div style={{ display: "grid", gap: 7 }}>
          <Row show={phase >= 0}>
            <Bar w={36} h={7} bg="rgba(147,197,253,0.7)" anim={0} />
            <Bar w={80} h={7} bg="rgba(219,234,254,0.8)" anim={0.2} />
          </Row>
          <Row show={phase >= 0} delay={0.1}>
            <Spacer />
            <Dot />
            <Bar w={100} h={7} bg="rgba(24,24,27,0.2)" anim={0.3} />
          </Row>
          <Row show={phase >= 1} delay={0.15}>
            <Spacer />
            <Bar w={48} h={7} bg="rgba(24,24,27,0.15)" anim={0.1} />
            <Bar w={40} h={7} bg="rgba(153,246,228,0.6)" anim={0.5} />
            <Bar w={56} h={7} bg="rgba(147,197,253,0.6)" anim={0.3} />
          </Row>
          <Row show={phase >= 1} delay={0.2}>
            <Spacer />
            <Dot />
            <Bar w={60} h={7} bg="rgba(24,24,27,0.15)" anim={0.4} />
          </Row>
          <Row show={phase >= 2} delay={0.25}>
            <Bar w={40} h={7} bg="rgba(153,246,228,0.5)" anim={0.2} />
            <Dot />
            <Bar w={48} h={7} bg="rgba(24,24,27,0.15)" anim={0.6} />
            <Bar w={64} h={7} bg="rgba(147,197,253,0.5)" anim={0.1} />
          </Row>
          <Row show={phase >= 2} delay={0.3}>
            <Bar w={36} h={7} bg="rgba(147,197,253,0.6)" anim={0.5} />
            <Bar w={36} h={7} bg="rgba(24,24,27,0.12)" anim={0.7} />
          </Row>
          <Row show={phase >= 3} delay={0.35}>
            <Dot />
            <Bar w={44} h={7} bg="rgba(24,24,27,0.18)" anim={0.3} />
            <Dot />
            <Bar w={56} h={7} bg="rgba(153,246,228,0.5)" anim={0.8} />
            <Bar w={48} h={7} bg="rgba(147,197,253,0.5)" anim={0.4} />
          </Row>
        </div>

        {/* Shimmer */}
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

      {/* Label */}
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

function Spacer() {
  return <div style={{ width: 12 }} />;
}

function Bar({
  w,
  h,
  bg,
  anim,
  opacity,
  transition,
}: {
  w: number;
  h: number;
  bg: string;
  anim?: number;
  opacity?: number;
  transition?: string;
}) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 9999,
        backgroundColor: bg,
        ...(anim !== undefined
          ? { animation: `cpk-a2ui-fade 2.4s ease-in-out ${anim}s infinite` }
          : {}),
        ...(opacity !== undefined ? { opacity } : {}),
        ...(transition ? { transition } : {}),
      }}
    />
  );
}

function Row({
  children,
  show,
  delay = 0,
}: {
  children: React.ReactNode;
  show: boolean;
  delay?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        opacity: show ? 1 : 0,
        transition: `opacity 0.4s ${delay}s`,
      }}
    >
      {children}
    </div>
  );
}

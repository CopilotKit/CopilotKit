import React, { useEffect, useRef } from "react";
import { useCopilotKit } from "../providers/CopilotKitProvider";
import { defineToolCallRenderer } from "../types/defineToolCallRenderer";
import { z } from "zod";

/**
 * Tool name used by the dynamic A2UI generation secondary LLM.
 * This renderer is auto-registered when A2UI is enabled.
 */
export const RENDER_A2UI_TOOL_NAME = "render_a2ui";

interface A2UIProgressProps {
  parameters: unknown;
}

/**
 * Built-in progress indicator for dynamic A2UI generation.
 * Shows a skeleton wireframe that progressively reveals as tokens stream in.
 *
 * Registered automatically when A2UI is enabled. Users can override by
 * providing their own `useRenderTool({ name: "render_a2ui", ... })`.
 */
function A2UIProgressIndicator({ parameters }: A2UIProgressProps) {
  const lastRef = useRef({ time: 0, tokens: 0 });
  const now = Date.now();

  let { tokens } = lastRef.current;
  if (now - lastRef.current.time > 200) {
    const chars = JSON.stringify(parameters ?? {}).length;
    tokens = Math.round(chars / 4);
    lastRef.current = { time: now, tokens };
  }

  const phase = tokens < 50 ? 0 : tokens < 200 ? 1 : tokens < 400 ? 2 : 3;

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
          style={{
            fontSize: 12,
            color: "#a1a1aa",
            letterSpacing: "0.025em",
          }}
        >
          Building interface
        </span>
        {tokens > 0 && (
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

// --- Primitives ---

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

// --- Hook entry point ---

/**
 * Registers the built-in `render_a2ui` tool call renderer via the props-based
 * `setRenderToolCalls` mechanism (not `useRenderTool`).
 *
 * This ensures user-registered `useRenderTool({ name: "render_a2ui", ... })`
 * hooks automatically override the built-in, since the merge logic in
 * react-core.ts gives hook-based entries priority over prop-based entries.
 */
export function A2UIBuiltInToolCallRenderer(): null {
  const { copilotkit } = useCopilotKit();

  useEffect(() => {
    const renderer = defineToolCallRenderer({
      name: RENDER_A2UI_TOOL_NAME,
      args: z.any(),
      render: ({ status, args: parameters }) => {
        if (status === "complete") return <></>;
        const params = parameters as any;
        // Hide skeleton once the A2UI surface has enough data to render.
        // For data-bound surfaces: items array is populated.
        // For dashboard-style surfaces: components array has multiple entries
        // (meaning the streaming path is emitting activity snapshots).
        const items = params?.items;
        if (Array.isArray(items) && items.length > 0) return <></>;
        const components = params?.components;
        if (Array.isArray(components) && components.length > 2) return <></>;
        return <A2UIProgressIndicator parameters={parameters} />;
      },
    });

    // Register via props-based mechanism so useRenderTool hooks take priority
    const existing = (copilotkit as any)._renderToolCalls ?? [];
    copilotkit.setRenderToolCalls([
      ...existing.filter((rc: any) => rc.name !== RENDER_A2UI_TOOL_NAME),
      renderer,
    ]);
  }, [copilotkit]);

  return null;
}

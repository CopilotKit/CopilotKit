"use client";

import { memo, useRef } from "react";

interface A2UIProgressProps {
  parameters: unknown;
}

/**
 * Progress indicator for dynamic A2UI generation.
 *
 * The render callback is invoked on every streaming token (~3000 times per
 * generation). We throttle JSON.stringify to every 200ms and memo the
 * component to keep React work minimal.
 */
export const A2UIProgress = memo(function A2UIProgress({
  parameters,
}: A2UIProgressProps) {
  const lastRef = useRef({ time: 0, tokens: 0 });
  const now = Date.now();

  let { tokens } = lastRef.current;
  if (now - lastRef.current.time > 200) {
    const chars = JSON.stringify(parameters ?? {}).length;
    tokens = Math.round(chars / 4);
    lastRef.current = { time: now, tokens };
  }

  return (
    <div className="my-2">
      <div className="relative overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 inline-flex items-center gap-3">
        {/* Shimmer sweep */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.025) 35%, rgba(0,0,0,0.05) 50%, rgba(0,0,0,0.025) 65%, transparent 100%)",
            backgroundSize: "250% 100%",
            animation: "a2ui-shimmer 2.8s ease-in-out infinite",
          }}
        />

        {/* Pulsing dot */}
        <div className="relative shrink-0 flex items-center justify-center w-5 h-5">
          <div
            className="absolute w-5 h-5 rounded-full bg-[var(--foreground)]"
            style={{
              opacity: 0.06,
              animation: "a2ui-ping 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
            }}
          />
          <div
            className="w-[6px] h-[6px] rounded-full bg-[var(--foreground)]"
            style={{ opacity: 0.4 }}
          />
        </div>

        {/* Text */}
        <div className="relative flex items-baseline gap-2 min-w-0">
          <span
            className="text-[13px] font-medium text-[var(--foreground)]"
            style={{ letterSpacing: "-0.01em" }}
          >
            Building your interface
          </span>
          <span className="text-[11px] tabular-nums text-[var(--muted-foreground)]">
            {tokens > 0 && `~${tokens.toLocaleString()} tokens`}
          </span>
        </div>
      </div>

      <style>{`
        @keyframes a2ui-shimmer {
          0% { background-position: 250% 0; }
          100% { background-position: -250% 0; }
        }
        @keyframes a2ui-ping {
          0%, 100% { transform: scale(1); opacity: 0.06; }
          50% { transform: scale(1.6); opacity: 0.02; }
        }
      `}</style>
    </div>
  );
});

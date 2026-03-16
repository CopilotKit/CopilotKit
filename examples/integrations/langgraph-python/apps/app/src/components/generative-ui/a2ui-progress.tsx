"use client";

import { memo, useRef } from "react";

interface A2UIProgressProps {
  parameters: unknown;
}

/**
 * Visual progress indicator for dynamic A2UI generation.
 * Shows a skeleton wireframe that represents components being assembled.
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

  // Progress phase: more skeleton elements appear as tokens increase
  const phase = tokens < 50 ? 0 : tokens < 200 ? 1 : tokens < 400 ? 2 : 3;

  return (
    <div className="my-3 max-w-[320px]">
      <div
        className="relative overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-sm"
        style={{ padding: "16px 18px 14px" }}
      >
        {/* Top bar: three dots + filename skeleton */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex gap-1">
            <div className="w-[7px] h-[7px] rounded-full bg-gray-300" />
            <div className="w-[7px] h-[7px] rounded-full bg-gray-300" />
            <div className="w-[7px] h-[7px] rounded-full bg-gray-300" />
          </div>
          <div
            className="h-[6px] rounded-full bg-gray-200"
            style={{ width: 64, opacity: phase >= 1 ? 1 : 0.4, transition: "opacity 0.5s" }}
          />
        </div>

        {/* Skeleton code lines */}
        <div className="space-y-[7px]">
          {/* Line 1 */}
          <div className="flex items-center gap-2" style={{ opacity: phase >= 0 ? 1 : 0, transition: "opacity 0.4s" }}>
            <div className="h-[7px] w-[36px] rounded-full bg-blue-200/70" style={{ animation: "a2ui-fade 2.4s ease-in-out infinite" }} />
            <div className="h-[7px] w-[80px] rounded-full bg-blue-100/80" style={{ animation: "a2ui-fade 2.4s ease-in-out 0.2s infinite" }} />
          </div>

          {/* Line 2 */}
          <div className="flex items-center gap-2" style={{ opacity: phase >= 0 ? 1 : 0, transition: "opacity 0.4s 0.1s" }}>
            <div className="w-3" />
            <div className="h-[6px] w-[6px] rounded-full bg-gray-300" />
            <div className="h-[7px] w-[100px] rounded-full bg-gray-800/20" style={{ animation: "a2ui-fade 2.4s ease-in-out 0.3s infinite" }} />
          </div>

          {/* Line 3: row of blocks */}
          <div className="flex items-center gap-[6px]" style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.4s 0.15s" }}>
            <div className="w-3" />
            <div className="h-[7px] w-[48px] rounded-full bg-gray-800/15" style={{ animation: "a2ui-fade 2.4s ease-in-out 0.1s infinite" }} />
            <div className="h-[7px] w-[40px] rounded-full bg-teal-200/60" style={{ animation: "a2ui-fade 2.4s ease-in-out 0.5s infinite" }} />
            <div className="h-[7px] w-[56px] rounded-full bg-blue-200/60" style={{ animation: "a2ui-fade 2.4s ease-in-out 0.3s infinite" }} />
          </div>

          {/* Line 4 */}
          <div className="flex items-center gap-2" style={{ opacity: phase >= 1 ? 1 : 0, transition: "opacity 0.4s 0.2s" }}>
            <div className="w-3" />
            <div className="h-[6px] w-[6px] rounded-full bg-gray-300" />
            <div className="h-[7px] w-[60px] rounded-full bg-gray-800/15" style={{ animation: "a2ui-fade 2.4s ease-in-out 0.4s infinite" }} />
          </div>

          {/* Line 5: wider row */}
          <div className="flex items-center gap-[6px]" style={{ opacity: phase >= 2 ? 1 : 0, transition: "opacity 0.4s 0.25s" }}>
            <div className="h-[7px] w-[40px] rounded-full bg-teal-200/50" style={{ animation: "a2ui-fade 2.4s ease-in-out 0.2s infinite" }} />
            <div className="h-[6px] w-[6px] rounded-full bg-gray-300" />
            <div className="h-[7px] w-[48px] rounded-full bg-gray-800/15" style={{ animation: "a2ui-fade 2.4s ease-in-out 0.6s infinite" }} />
            <div className="h-[7px] w-[64px] rounded-full bg-blue-200/50" style={{ animation: "a2ui-fade 2.4s ease-in-out 0.1s infinite" }} />
          </div>

          {/* Line 6 */}
          <div className="flex items-center gap-2" style={{ opacity: phase >= 2 ? 1 : 0, transition: "opacity 0.4s 0.3s" }}>
            <div className="h-[7px] w-[36px] rounded-full bg-blue-200/60" style={{ animation: "a2ui-fade 2.4s ease-in-out 0.5s infinite" }} />
            <div className="h-[7px] w-[36px] rounded-full bg-gray-800/12" style={{ animation: "a2ui-fade 2.4s ease-in-out 0.7s infinite" }} />
          </div>

          {/* Line 7: bottom row */}
          <div className="flex items-center gap-[6px]" style={{ opacity: phase >= 3 ? 1 : 0, transition: "opacity 0.4s 0.35s" }}>
            <div className="h-[6px] w-[6px] rounded-full bg-gray-300" />
            <div className="h-[7px] w-[44px] rounded-full bg-gray-800/18" style={{ animation: "a2ui-fade 2.4s ease-in-out 0.3s infinite" }} />
            <div className="h-[6px] w-[6px] rounded-full bg-gray-300" />
            <div className="h-[7px] w-[56px] rounded-full bg-teal-200/50" style={{ animation: "a2ui-fade 2.4s ease-in-out 0.8s infinite" }} />
            <div className="h-[7px] w-[48px] rounded-full bg-blue-200/50" style={{ animation: "a2ui-fade 2.4s ease-in-out 0.4s infinite" }} />
          </div>
        </div>

        {/* Shimmer overlay */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(105deg, transparent 0%, transparent 40%, rgba(255,255,255,0.6) 50%, transparent 60%, transparent 100%)",
            backgroundSize: "250% 100%",
            animation: "a2ui-sweep 3s ease-in-out infinite",
          }}
        />
      </div>

      {/* Label below */}
      <div className="flex items-center justify-center gap-2 mt-2">
        <span className="text-[12px] text-gray-400 tracking-wide">
          Building interface
        </span>
        <span className="text-[11px] tabular-nums text-gray-300">
          {tokens > 0 && `~${tokens.toLocaleString()} tokens`}
        </span>
      </div>

      <style>{`
        @keyframes a2ui-fade {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes a2ui-sweep {
          0% { background-position: 250% 0; }
          100% { background-position: -250% 0; }
        }
      `}</style>
    </div>
  );
});

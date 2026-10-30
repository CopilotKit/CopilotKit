"use client";

import { useEffect } from "react";
import { StaticSurface } from "@/components/app/static-surface";
import {
  useUIGeneration,
  type UseUIGenerationOptions,
} from "@/components/app/use-ui-generation";
import { AskingJev } from "./parts";
import type { JevResult, JevRunState } from "./use-jev-run";

type Gen = Omit<UseUIGenerationOptions, "runKey" | "enabled">;

/**
 * The surface, played in with the same transitions.dev generation run as /watch and the landing replay:
 * dot field, guides and outline over the real measured surface, then the scan-line reveal (about 1 s).
 * Real ops are in the DOM the moment Jev's answer lands; that moment is what "rendered" measures.
 */
export function JevStage({
  result,
  state,
  host,
  gen,
  className,
  style,
  onGenerating,
  waitLabel = "Finding cafés, asking Jev",
}: {
  result: JevResult | null;
  state: JevRunState;
  host: React.RefObject<HTMLDivElement | null>;
  gen?: Gen;
  className?: string;
  style?: React.CSSProperties;
  onGenerating?: (g: boolean) => void;
  waitLabel?: string;
}) {
  const generating = useUIGeneration(host, {
    runKey: result?.surfaceId ?? null,
    mode: "skeleton",
    duration: 900,
    maxParts: 40,
    ...gen,
  });
  useEffect(() => onGenerating?.(generating), [generating, onGenerating]);
  if (result) {
    return (
      <div
        ref={host}
        key={result.surfaceId}
        className={`a2-surface-host relative ${className ?? ""}`}
        style={style}
        data-build={generating ? "building" : "done"}
      >
        <StaticSurface ops={result.ops} />
      </div>
    );
  }
  if (state.phase === "running") return <AskingJev label={waitLabel} />;
  if (state.phase === "notice") {
    return (
      <div className="jev-row-in rounded-2xl border border-[var(--jev-line)] bg-[var(--jev-panel)] px-6 py-5">
        <p className="text-[16px] text-foreground">{state.notice.notice}</p>
        <p className="mt-1.5 text-[14px] text-muted-foreground">
          Cafés come from OpenStreetMap, so nothing is shown that it does not
          have.
        </p>
      </div>
    );
  }
  return null;
}

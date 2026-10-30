import type { GenerativeUIChatSurfaceProps } from "@copilotkit/react-core/v2/generative-ui";
import { Braces } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { PixelateFilter, runDecompile } from "../lib/decompile";
import { useArrivalCascade } from "../lib/use-arrival-cascade";
import { useSurfaceOperations } from "../lib/use-surfaces";
import { SourcePlate } from "./SourcePlate";

const NONE: readonly unknown[] = [];

/** Frames each generated view in the chat with the A2UI behind it. */
export function SurfaceFrame(props: GenerativeUIChatSurfaceProps) {
  const operations = useSurfaceOperations(props.surfaceId);
  return <ViewFrame {...props} operations={operations} />;
}

/**
 * A view and the A2UI that made it. The A2UI button on the frame's top edge
 * decompiles the view: it breaks into blocks that resolve into its A2UI.
 * Pressed again, the A2UI compiles back into the view.
 */
export function ViewFrame({
  surfaceId,
  operations,
  isStreaming = false,
  rejected = NONE,
  className,
  head,
  children,
}: {
  surfaceId: string;
  operations: readonly unknown[];
  isStreaming?: boolean;
  rejected?: readonly unknown[];
  className?: string;
  /** Drawn at the top of the frame, outside the view and its A2UI. */
  head?: ReactNode;
  children: ReactNode;
}) {
  const [showingSource, setShowingSource] = useState(false);
  const [decompiling, setDecompiling] = useState<"in" | "out" | null>(null);
  // The plate is only in the page while it shows or animates, so the many
  // views of a long thread carry no source DOM.
  const plateMounted = showingSource || decompiling !== null;

  const view = useRef<HTMLDivElement>(null);
  const plate = useRef<HTMLDivElement>(null);
  const viewFilter = useRef<SVGFilterElement>(null);
  const plateFilter = useRef<SVGFilterElement>(null);
  const filterId = `pixelate-${useId().replace(/[^\w-]/g, "")}`;

  useArrivalCascade(view, isStreaming);

  useEffect(() => {
    if (!decompiling) return;
    const [viewLayer, plateLayer] = [view.current, plate.current];
    const [viewPixels, platePixels] = [viewFilter.current, plateFilter.current];
    if (!viewLayer || !plateLayer || !viewPixels || !platePixels) return;
    const toSource = decompiling === "in";
    const layers = {
      view: viewLayer,
      viewFilter: viewPixels,
      plate: plateLayer,
      plateFilter: platePixels,
    };
    return runDecompile(layers, toSource, () => {
      setShowingSource(toSource);
      setDecompiling(null);
    });
  }, [decompiling]);

  const toggle = () => {
    if (decompiling) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) setShowingSource((value) => !value);
    else setDecompiling(showingSource ? "out" : "in");
  };

  return (
    <figure
      className={className ? `surface ${className}` : "surface"}
      data-surface-id={surfaceId}
      data-streaming={isStreaming || undefined}
      data-decompiling={decompiling ?? undefined}
    >
      {head}
      <svg className="surface__filters" aria-hidden focusable="false">
        <PixelateFilter ref={viewFilter} id={`${filterId}-view`} />
        <PixelateFilter ref={plateFilter} id={`${filterId}-plate`} />
      </svg>

      <div
        ref={view}
        className="surface__render"
        inert={showingSource ? true : undefined}
      >
        {children}
      </div>

      {plateMounted && (
        <SourcePlate
          ref={plate}
          operations={operations}
          rejected={rejected}
          revealed={showingSource || decompiling === "in"}
        />
      )}

      <button
        type="button"
        className="surface__toggle"
        aria-pressed={showingSource}
        aria-label={showingSource ? "Show the view" : "Show the A2UI"}
        onClick={toggle}
      >
        <Braces size={13} strokeWidth={2} aria-hidden />
        A2UI
      </button>
    </figure>
  );
}

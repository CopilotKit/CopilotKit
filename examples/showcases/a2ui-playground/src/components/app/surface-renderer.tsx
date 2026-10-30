"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  useCopilotKit,
  type ReactActivityMessageRenderer,
} from "@copilotkit/react-core/v2";
import {
  GENERATIVE_UI_ACTIVITY_TYPE,
  type GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { z } from "zod";
import { cn } from "@/lib/utils";
import {
  contentCount,
  latestComponents,
  runStore,
  useRunStore,
  type A2UIOp,
} from "@/lib/run-store";
import { ResizeBox } from "./build-sequence";
import { useLandingReveal } from "./use-landing-reveal";
import { useUIGeneration } from "./use-ui-generation";

type Props = React.ComponentProps<
  ReactActivityMessageRenderer<GenerativeUISurfaceContent>["render"]
>;

/**
 * CopilotKit's own Gen UI 2.0 surface renderer: the one the provider registers
 * for `generative-ui-surface` activities when `generativeUI` is set. It
 * validates and applies each A2UI v1.0 operation and paints the surface.
 * The playground's mirror sits in front of it, so it is looked up past that.
 */
export function useBaseSurfaceRenderer(): ComponentType<Props> | undefined {
  const { copilotkit } = useCopilotKit();
  const base = copilotkit.renderActivityMessages.find(
    (r) =>
      r.activityType === GENERATIVE_UI_ACTIVITY_TYPE && r !== surfaceRenderer,
  );
  return base?.render as ComponentType<Props> | undefined;
}

/**
 * The chat's surface renderer, wrapped:
 *  - CopilotKit's renderer still paints the surface inside the chat transcript
 *    (validation, bindings, events, all of it);
 *  - every operation list is also mirrored into the playground store, so the
 *    json tab, the build log and the live canvas see exactly the operations
 *    the chat applied.
 */
function Mirrored(props: Props) {
  const Base = useBaseSurfaceRenderer();
  const key = props.message?.id ?? "surface";
  const ops = props.content?.operations;
  const last = useRef(0);
  const [hasFrame, setHasFrame] = useState(false);
  useEffect(() => {
    if (!Array.isArray(ops) || !ops.length || ops.length === last.current)
      return;
    last.current = ops.length;
    runStore.upsertSurface(
      key,
      ops as unknown as Array<Record<string, unknown>>,
    );
    setHasFrame(true);
  }, [ops, key]);
  // A run that ended (stopped, failed, or a surface restored from an earlier visit) never fills its
  // pending slots: drop them instead of pulsing forever. The chat says what happened under the surface.
  const halted = useRunStore((s) => {
    const rec = s.surfaces[key];
    if (!rec) return false;
    const run = rec.runId ? s.runs.find((r) => r.id === rec.runId) : undefined;
    return run?.status !== "running";
  });
  const pending = useMemo(
    () =>
      Array.isArray(ops)
        ? latestComponents(ops as unknown as A2UIOp[]).some(
            (c) => c.component === "Blueprint",
          )
        : false,
    [ops],
  );
  const empty = useMemo(
    () => halted && pending && contentCount(ops as unknown as A2UIOp[]) === 0,
    [halted, pending, ops],
  );
  const collapse = halted && pending;
  // transitions.dev UI generation (skeleton) over the surface, once per message, from its first frame.
  const host = useRef<HTMLDivElement>(null);
  // Only the newest surface of a live template run plays the whole drawing: a template's tree arrives at once,
  // which is what the drawing is for. A composed surface streams in, standing as dotted frames that each
  // reveal as their component lands (use-landing-reveal.ts), so it plays no drawing on top of them. Surfaces
  // from earlier messages (history, remounts) show as they are.
  // Decided once, at the first frame: is this host the last surface on the page?
  const [animate, setAnimate] = useState<boolean | null>(null);
  useEffect(() => {
    if (!hasFrame || animate !== null || !host.current) return;
    const all = document.querySelectorAll(".a2-surface-host");
    const run = runStore.current();
    setAnimate(
      all[all.length - 1] === host.current &&
        run?.status === "running" &&
        run.path === "fixed",
    );
  }, [hasFrame, animate]);
  const generating = useUIGeneration(host, {
    runKey: hasFrame && animate ? key : null,
    enabled: !collapse,
    mode: "skeleton",
    maxParts: 40,
  });
  useLandingReveal(host, !halted && !generating);
  return (
    <ResizeBox>
      <div
        ref={host}
        className={cn(
          "a2-surface-host relative",
          collapse && "[&_.a2-blueprint]:hidden",
          empty && "hidden",
        )}
        data-surface-key={key}
        data-build={generating ? "building" : "done"}
        data-halted={collapse || undefined}
      >
        {Base ? <Base {...props} /> : null}
      </div>
    </ResizeBox>
  );
}

export const surfaceRenderer: ReactActivityMessageRenderer<GenerativeUISurfaceContent> =
  {
    activityType: GENERATIVE_UI_ACTIVITY_TYPE,
    content:
      z.any() as unknown as ReactActivityMessageRenderer<GenerativeUISurfaceContent>["content"],
    render: Mirrored,
  };

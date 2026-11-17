"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { useCopilotKit } from "@copilotkit/react-core/v2";
import type { ReactActivityMessageRenderer } from "@copilotkit/react-core/v2";
import { GENERATIVE_UI_ACTIVITY_TYPE } from "@copilotkit/shared";
import type { GenerativeUISurfaceContent } from "@copilotkit/shared";
import { z } from "zod";
import { cn } from "@/lib/utils";
import {
  contentCount,
  latestComponents,
  runStore,
  useRunStore,
} from "@/lib/run-store";
import type { A2UIOp } from "@/lib/run-store";
import { useDesignSystem } from "@/design-systems/context";
import { HOST_CLASS } from "@/design-systems/registry";
import { ResizeBox } from "./build-sequence";
import { useDesignSystemRedraw } from "./use-design-system-redraw";
import { useLandingReveal } from "./use-landing-reveal";
import { useUIGeneration } from "./use-ui-generation";

type Props = React.ComponentProps<
  ReactActivityMessageRenderer<GenerativeUISurfaceContent>["render"]
>;

/**
 * CopilotKit's own Gen UI 2.0 surface renderer: the one the provider registers
 * for `generative-ui-surface` activities when `generativeUI` is set. It
 * validates and applies each A2UI 1.0 operation and paints the surface.
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
  // The operations can change in place (an activity delta patches the same array, keeping its length, as a
  // template fills its placeholders), so what changed is read from their content, not the array or its length.
  const sig = Array.isArray(ops) ? JSON.stringify(ops) : "";
  const last = useRef("");
  const [hasFrame, setHasFrame] = useState(false);
  useEffect(() => {
    if (!Array.isArray(ops) || !ops.length || sig === last.current) return;
    last.current = sig;
    // A snapshot per version: the store and its readers key on identity, and the live array keeps changing.
    runStore.upsertSurface(
      key,
      JSON.parse(sig) as Array<Record<string, unknown>>,
    );
    setHasFrame(true);
    // `sig` stands for `ops`: the same array can carry new operations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, key]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig],
  );
  const empty = useMemo(
    () => halted && pending && contentCount(ops as unknown as A2UIOp[]) === 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [halted, pending, sig],
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
  // A design system switch redraws a finished surface on screen; one still streaming takes the new look.
  const runKey = useDesignSystemRedraw(host, {
    base: hasFrame && animate ? key : null,
    enabled: halted && !collapse,
  });
  const generating = useUIGeneration(host, {
    runKey,
    enabled: !collapse,
    mode: "skeleton",
    maxParts: 40,
  });
  useLandingReveal(host, !halted && !generating);
  const ds = useDesignSystem().id;
  return (
    <ResizeBox>
      <div
        ref={host}
        className={cn(
          "a2-surface-host relative",
          HOST_CLASS[ds],
          collapse && "[&_.a2-blueprint]:hidden",
          empty && "hidden",
        )}
        data-ds={ds}
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

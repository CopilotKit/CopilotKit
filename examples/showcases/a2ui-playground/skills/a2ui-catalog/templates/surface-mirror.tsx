"use client";

import { useEffect, useRef, type ComponentType } from "react";
import { useCopilotKit, type ReactActivityMessageRenderer } from "@copilotkit/react-core/v2";
import { GENERATIVE_UI_ACTIVITY_TYPE, type GenerativeUISurfaceContent } from "@copilotkit/shared";
import { z } from "zod";

type Props = React.ComponentProps<ReactActivityMessageRenderer<GenerativeUISurfaceContent>["render"]>;
type A2UIOp = Record<string, unknown>;

/** Replace with your own store/bus: called with every operation list the chat renders. */
export const onSurfaceOps = { current: (_key: string, _ops: A2UIOp[]) => {} };

/**
 * CopilotKit's own Gen UI 2.0 surface renderer: the one the provider registers
 * for `generative-ui-surface` activities when `generativeUI` is set. It
 * validates and applies each A2UI v1.0 operation and paints the surface.
 * The mirror below sits in front of it (user renderers are consulted first),
 * so it is looked up past that.
 */
export function useBaseSurfaceRenderer(): ComponentType<Props> | undefined {
  const { copilotkit } = useCopilotKit();
  const base = copilotkit.renderActivityMessages.find((r) => r.activityType === GENERATIVE_UI_ACTIVITY_TYPE && r !== surfaceRenderer);
  return base?.render as ComponentType<Props> | undefined;
}

/**
 * The chat's surface renderer, wrapped:
 *  - CopilotKit's renderer still paints the surface inside the chat transcript
 *    (validation, bindings, events, all of it);
 *  - every operation list is also mirrored into your store, so a side canvas,
 *    a JSON view or a build log sees exactly the operations the chat applied.
 * `content.operations` is cumulative: the agent appends to it with ACTIVITY_DELTA.
 */
function Mirrored(props: Props) {
  const Base = useBaseSurfaceRenderer();
  const key = props.message?.id ?? "surface";
  const ops = props.content?.operations;
  const last = useRef(0);
  useEffect(() => {
    if (!Array.isArray(ops) || !ops.length || ops.length === last.current) return;
    last.current = ops.length;
    onSurfaceOps.current(key, ops as unknown as A2UIOp[]);
  }, [ops, key]);
  return (
    <div className="a2-surface-host" data-surface-key={key}>
      {Base ? <Base {...props} /> : null}
    </div>
  );
}

/** Pass in `renderActivityMessages={[surfaceRenderer]}` on `CopilotKitProvider`. */
export const surfaceRenderer: ReactActivityMessageRenderer<GenerativeUISurfaceContent> = {
  activityType: GENERATIVE_UI_ACTIVITY_TYPE,
  content: z.any() as unknown as ReactActivityMessageRenderer<GenerativeUISurfaceContent>["content"],
  render: Mirrored,
};

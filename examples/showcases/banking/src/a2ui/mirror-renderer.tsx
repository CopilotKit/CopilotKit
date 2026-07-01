"use client";

import { useEffect } from "react";
import { z } from "zod";
import type { ReactActivityMessageRenderer } from "@copilotkit/react-core/v2";
import { surfaceBus } from "./surface-bus";
import type { A2UIOp } from "./surface-bus";

const ContentSchema = z.object({
  a2ui_operations: z.array(z.record(z.string(), z.unknown())),
});
type Content = z.infer<typeof ContentSchema>;

function MirrorPill({ ops, agentId }: { ops: A2UIOp[]; agentId?: string }) {
  useEffect(() => {
    if (!ops?.length) return;
    surfaceBus.push(agentId ?? "default", ops);
  }, [ops, agentId]);
  return (
    <div className="my-1.5 inline-flex max-w-fit items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-2 text-xs font-medium text-ink">
      <span className="h-2 w-2 rounded-full bg-brand" />
      <span className="uppercase tracking-wide text-ink-muted">report</span>
      <span aria-hidden className="text-ink-muted">→</span>
      <span>rendered on the canvas</span>
    </div>
  );
}

/** Captures A2UI surfaces from the chat stream and forwards them to the
 *  ReportCanvas; leaves a pill in chat as the handoff signal. */
export function createMirrorActivityRenderer(
  agentId?: string,
): ReactActivityMessageRenderer<Content> {
  return {
    activityType: "a2ui-surface",
    agentId,
    content: ContentSchema,
    render: ({ content }) => (
      <MirrorPill ops={(content.a2ui_operations as A2UIOp[]) ?? []} agentId={agentId} />
    ),
  };
}

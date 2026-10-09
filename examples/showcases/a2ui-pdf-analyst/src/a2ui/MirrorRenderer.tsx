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
    console.log(
      `[mirror-renderer] forwarding ${ops.length} ops for agent=${agentId ?? "default"}`,
    );
    surfaceBus.push(agentId ?? "default", ops);
  }, [ops, agentId]);
  return (
    <div className="my-1.5 inline-flex items-center gap-2 max-w-fit px-3 py-2 rounded-full border border-[var(--line)] bg-[color-mix(in_oklab,var(--lilac)_8%,var(--surface))] text-[12.5px] text-[var(--ink)] font-medium leading-none">
      <span className="w-2 h-2 rounded-full bg-[var(--lilac)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--lilac)_30%,transparent)]" />
      <span className="mono uppercase tracking-[0.1em] text-[10.5px] text-[var(--ink)]">
        surface
      </span>
      <span aria-hidden className="text-[var(--ink)]/40">
        →
      </span>
      <span>rendered in the canvas</span>
    </div>
  );
}

/** Custom activity renderer: captures A2UI surfaces from the chat stream
 *  and forwards them to the workspace canvas. In place of the inline render
 *  we leave a small pill in chat so the user has a clear handoff signal. */
export function createMirrorActivityRenderer(
  agentId?: string,
): ReactActivityMessageRenderer<Content> {
  return {
    activityType: "a2ui-surface",
    agentId,
    content: ContentSchema,
    render: ({ content }) => (
      <MirrorPill
        ops={(content.a2ui_operations as A2UIOp[]) ?? []}
        agentId={agentId}
      />
    ),
  };
}

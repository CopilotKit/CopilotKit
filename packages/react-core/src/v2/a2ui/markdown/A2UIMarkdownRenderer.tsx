"use client";
import React, { useMemo } from "react";
import { Streamdown } from "streamdown";
import {
  extractFenceOperations,
  getOperationSurfaceId,
  splitA2UIMarkdown,
} from "@copilotkit/core";
import type { A2UIOperation, MarkdownSegment } from "@copilotkit/core";
import { A2UIMarkdownSurface } from "./A2UIMarkdownSurface";

/** Splits (possibly streaming) assistant markdown into prose and a2ui fences. */
export function useA2UIMarkdownSegments(content: string): MarkdownSegment[] {
  return useMemo(() => splitA2UIMarkdown(content ?? ""), [content]);
}

export type A2UIMarkdownRendererProps = Omit<
  React.ComponentProps<typeof Streamdown>,
  "children"
> & {
  content: string;
  messageId: string;
};

/**
 * Renders assistant markdown with ```a2ui fences replaced by live A2UI surfaces.
 * Prose segments go through Streamdown unchanged; fences go to A2UIMarkdownSurface.
 * Fences that reuse an earlier fence's surfaceId contribute their operations to
 * that surface and render nothing themselves.
 */
export function A2UIMarkdownRenderer({
  content,
  messageId,
  className,
  ...streamdownProps
}: A2UIMarkdownRendererProps) {
  const segments = useA2UIMarkdownSegments(content);

  const plan = useMemo(() => {
    const owners = new Map<string, number>(); // surfaceId -> owning fence index
    const extras = new Map<number, A2UIOperation[]>();
    const hidden = new Set<number>();
    for (const seg of segments) {
      if (seg.type !== "a2ui") continue;
      const ops = extractFenceOperations(seg.text).operations;
      const surfaceId =
        ops.map(getOperationSurfaceId).find((id): id is string => !!id) ??
        `${messageId}-${seg.index}`;
      const owner = owners.get(surfaceId);
      if (owner === undefined) {
        owners.set(surfaceId, seg.index);
        continue;
      }
      hidden.add(seg.index);
      extras.set(owner, [...(extras.get(owner) ?? []), ...ops]);
    }
    return { extras, hidden };
  }, [segments, messageId]);

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "markdown" ? (
          <Streamdown key={`md-${i}`} className={className} {...streamdownProps}>
            {seg.text}
          </Streamdown>
        ) : (
          <A2UIMarkdownSurface
            key={`a2ui-${seg.index}`}
            fenceText={seg.text}
            closed={seg.closed}
            fallbackSurfaceId={`${messageId}-${seg.index}`}
            extraOperations={plan.extras.get(seg.index)}
            hidden={plan.hidden.has(seg.index)}
          />
        ),
      )}
    </>
  );
}

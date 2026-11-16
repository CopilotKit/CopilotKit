"use client";

import { useParams } from "next/navigation";

/**
 * The CopilotKit runtime URL for a demo page: `/api/<integration>/<runtimeKey>`.
 * The integration comes from the page's `[integration]` route segment.
 *
 * Call it from a component under /demos/[integration]. Anywhere else it
 * throws, because there is no integration to send the requests to.
 *
 * @example
 * const runtimeUrl = useDemoRuntimeUrl("agentic-chat");
 * return <CopilotKit runtimeUrl={runtimeUrl} agent="agentic_chat">...</CopilotKit>;
 */
export function useDemoRuntimeUrl(runtimeKey: string) {
  const { integration } = useParams();
  if (typeof integration !== "string") {
    throw new Error(
      "useDemoRuntimeUrl needs the [integration] route segment: call it from a page under /demos/[integration].",
    );
  }
  return `/api/${integration}/${runtimeKey}`;
}

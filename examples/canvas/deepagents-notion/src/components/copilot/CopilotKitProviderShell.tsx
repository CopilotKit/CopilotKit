"use client";

/**
 * CopilotKitProviderShell — client-side wrapper around CopilotKitProvider.
 *
 * Why this lives in its own file: the provider's `renderToolCalls` config
 * carries non-plain values (zod schemas + component refs) that can't be
 * serialized across the server→client boundary if registered directly
 * inside the root server-component layout. Wrapping the provider in this
 * client component keeps the schema construction client-side, and the
 * server layout just renders <CopilotKitProviderShell>{children}</…>.
 *
 * Tool-call rendering registry:
 *   { name: "*", args: z.any(), render: ToolCallView }
 *
 * Catches every tool invocation that doesn't have its own dedicated
 * `useFrontendTool({ render })`. CopilotKit's resolver prefers exact-name
 * matches over the wildcard, so the bespoke render slots in page.tsx
 * (renderEmailDraft, renderEnrichmentStream, etc.) still take precedence.
 */

import { z } from "zod";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { ToolCallView } from "./ToolCallView";

const RENDER_TOOL_CALLS = [
  { name: "*", args: z.any(), render: ToolCallView },
];

export function CopilotKitProviderShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      publicApiKey={process.env.NEXT_PUBLIC_COPILOT_CLOUD_PUBLIC_API_KEY}
      openGenerativeUI={{}}
      renderToolCalls={RENDER_TOOL_CALLS}
    >
      {children}
    </CopilotKitProvider>
  );
}

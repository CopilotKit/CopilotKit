"use client";

/**
 * Headless = bring-your-own-UI. Simple = the smallest possible chat using
 * the two core hooks (`useAgent` + `useCopilotKit`), styled with plain,
 * self-contained primitives (no shadcn, no shared component library).
 *
 * The `headless-simple` agent is registered in the runtime route so that
 * `useAgent({ agentId: "headless-simple" })` resolves — an unregistered
 * agentId hard-fails the page.
 */

import { CopilotKit } from "@copilotkit/react-core/v2";
import { Chat } from "./chat";

export default function HeadlessSimpleDemo() {
  return (
    // @region[provider-setup]
    <CopilotKit runtimeUrl="/api/copilotkit" agent="headless-simple">
      <Chat />
    </CopilotKit>
    // @endregion[provider-setup]
  );
}

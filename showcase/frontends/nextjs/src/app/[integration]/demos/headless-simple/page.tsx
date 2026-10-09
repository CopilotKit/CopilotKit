"use client";

/**
 * Headless = bring-your-own-UI. Simple = the smallest possible chat using
 * the two core hooks (`useAgent` + `useCopilotKit`), styled with shadcn/ui.
 */

import { useParams } from "next/navigation";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { Chat } from "./chat";

export default function HeadlessSimpleDemo() {
  const { integration } = useParams<{ integration: string }>();
  return (
    <CopilotKit
      runtimeUrl={`/api/${integration}/headless-simple`}
      agent="headless-simple"
    >
      <Chat />
    </CopilotKit>
  );
}

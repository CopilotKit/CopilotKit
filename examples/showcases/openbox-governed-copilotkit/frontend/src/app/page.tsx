"use client";

import "@copilotkit/react-core/v2/styles.css";

import { CopilotChat, CopilotKit } from "@copilotkit/react-core/v2";
import {
  createOpenBoxCustomMessageRenderer,
  OpenBoxActionResult,
  OpenBoxGovernanceDecision,
} from "@openbox-ai/openbox-sdk/copilotkit/react";

const openBoxCustomMessageRenderers = [
  createOpenBoxCustomMessageRenderer({
    theme: {
      accentColor: "#3B9AF5",
      radius: 8,
      density: "comfortable",
      mode: "auto",
    },
    renderGovernanceDecision: (props) => (
      <OpenBoxGovernanceDecision {...(props as any)} />
    ),
    renderActionResult: ({ result }) => <OpenBoxActionResult result={result} />,
  }),
];

export default function HomePage() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      renderCustomMessages={openBoxCustomMessageRenderers}
      useSingleEndpoint={false}
    >
      <main className="h-screen">
        <CopilotChat agentId="default" className="h-full" />
      </main>
    </CopilotKit>
  );
}

"use client";

// Chat Customization (CSS) — all theming lives in theme.css, scoped to the
// `.chat-css-demo-scope` wrapper. The page stays intentionally minimal;
// only <CopilotChat /> is visibly re-themed.
//
// https://docs.copilotkit.ai/custom-look-and-feel/customize-built-in-ui-components

import React, { use } from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";
// @region[theme-css-import]
import "./theme.css";
// @endregion[theme-css-import]

const DEMO_ID = "chat-customization-css";

export default function ChatCustomizationCssDemo({
  params,
}: {
  params: Promise<{ framework: string }>;
}) {
  const { framework } = use(params);
  return (
    <CopilotKit runtimeUrl={`/api/${framework}/${DEMO_ID}`} agent={DEMO_ID}>
      <div className="flex justify-center items-center h-screen w-full">
        <div className="chat-css-demo-scope h-full w-full max-w-4xl">
          <CopilotChat
            agentId={DEMO_ID}
            className="h-full rounded-2xl"
          />
        </div>
      </div>
    </CopilotKit>
  );
}

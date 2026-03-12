"use client";

import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
import { ReactNode } from "react";

/**
 * Preview Layout
 *
 * This layout wraps the preview iframe content with CopilotKit.
 * It uses fixed agent configuration that connects to the local development agent.
 */
export default function PreviewLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <CopilotKit
          runtimeUrl="/api/copilotkit-preview"
          agent="sample_agent"
        >
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}

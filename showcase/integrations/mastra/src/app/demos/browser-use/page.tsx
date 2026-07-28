"use client";

/**
 * Browser Use (Mastra, OSS-91).
 *
 * A Mastra browser-navigation agent: you chat, the agent drives a REAL local
 * headless browser (Playwright Chromium — no hosted-browser API key), and the
 * results render inline in the CopilotKit chat as cards. Modeled on Mastra's
 * HackerNews browser example.
 *
 * Mastra-only + real-LLM: browser navigation is non-deterministic (live pages
 * change every request), so this cell has NO aimock replay fixture and is not
 * a D6 cell. See qa/browser-use.md and tests/e2e/browser-use.spec.ts.
 *
 * Runtime requirement: the local Chromium binary must be installed once via
 * `npx playwright install chromium`. If it is missing, the `browse_web` tool
 * returns a structured error the agent relays instead of crashing.
 */

import React from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { Chat } from "./chat";

export default function BrowserUseDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit-browser-use" agent="browser-use">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

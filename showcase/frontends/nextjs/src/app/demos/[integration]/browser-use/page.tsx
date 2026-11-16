"use client";

/**
 * Browser Use demo.
 *
 * You chat with a Mastra browser-navigation agent. The agent drives a real
 * local headless browser (Playwright Chromium, so no hosted browser API key
 * is needed), and the results render inline in the chat as cards. The demo
 * follows Mastra's Hacker News browser example.
 *
 * The demo needs a real LLM. Live pages change on every request, so browser
 * navigation is not deterministic. This demo has no aimock replay fixture,
 * and its e2e spec only checks that the page loads.
 *
 * The server needs the local Chromium binary, installed once with
 * `npx playwright install chromium`. When it is missing, the `browse_web`
 * tool returns an error that the agent passes on, and the run does not crash.
 */

import { CopilotKit } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { Chat } from "./chat";

export default function BrowserUseDemo() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("browser-use")}
      agent="browser-use"
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

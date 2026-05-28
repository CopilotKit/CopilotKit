"use client";

import { useState } from "react";
import { ArrowRight, Bot, Check, Copy } from "lucide-react";

const PROMPT = `Help me get started with CopilotKit — the frontend stack for AI agents and generative UI.

First, install the CopilotKit skills:

  npx skills add CopilotKit/CopilotKit

Then use the \`copilotkit-setup\` skill to guide the setup.

If your agent doesn't support skills, use the CopilotKit MCP server instead:
https://mcp.copilotkit.ai/mcp

Please ask me the following questions one at a time:
1. What framework are you using? (e.g. Next.js, Vite + React, Remix, other)
2. What do you want to name your project?
3. What are you trying to accomplish?
4. Are you starting a new project or integrating CopilotKit into an existing one?

Once you have my answers, use the installed skills to guide me through setup step by step.`;

export function AgentStartPrompt() {
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(PROMPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="not-prose my-6 rounded-lg border border-black/6 bg-[#FAFAFA] dark:border-white/10 dark:bg-white/5">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-black/6 dark:border-white/10">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-gray-500 dark:text-gray-400 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-[#010507] dark:text-white leading-tight">
              Start with CopilotKit
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 leading-tight">
              Paste this prompt into your AI agent to get started
            </div>
          </div>
        </div>
        <button
          onClick={handleCopy}
          className="ml-4 shrink-0 rounded p-1.5 text-gray-500 transition-colors hover:bg-black/5 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-200 cursor-pointer"
          aria-label="Copy prompt"
        >
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <pre className="text-sm font-mono text-[#010507] dark:text-white whitespace-pre-wrap break-words bg-transparent">
          {PROMPT}
        </pre>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-black/6 dark:border-white/10">
        <a
          href="/build-with-agents"
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 dark:text-indigo-300 hover:text-indigo-800 dark:hover:text-indigo-200 no-underline"
        >
          Learn more about building with agents
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

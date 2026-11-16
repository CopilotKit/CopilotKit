"use client";

/**
 * Open-Ended Generative UI: minimal setup.
 * -----------------------------------------
 * The simplest possible example. Enabling `openGenerativeUI` in the
 * runtime (see `src/demo-runtime-options.ts`) is all that's needed. The
 * runtime middleware streams agent-authored HTML + CSS to the built-in
 * `OpenGenerativeUIActivityRenderer`, which mounts it inside a sandboxed
 * iframe. No custom sandbox functions, no custom tools: just chat.
 *
 * This page customises the LLM's visual-authoring prompt with
 * `openGenerativeUI.designSkill` on the provider (see
 * `VISUALIZATION_DESIGN_SKILL` in `./design-skill.ts`), so the cell
 * showcases rich educational visualisations (3D axes, neural nets,
 * algorithms).
 *
 * Reference: https://docs.copilotkit.ai/generative-ui/open-generative-ui
 */

import React from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";

import type { OpenGenUiConfig } from "./config";
import {
  TOOL_CALL_INSTRUCTION,
  VISUALIZATION_DESIGN_SKILL,
} from "./design-skill";
import { Chat } from "./chat";

export function OpenGenUiDemo({ config }: { config: OpenGenUiConfig }) {
  const designSkill = config.instructToolCall
    ? `${TOOL_CALL_INSTRUCTION}\n\n${VISUALIZATION_DESIGN_SKILL}`
    : VISUALIZATION_DESIGN_SKILL;

  // @region[minimal-provider-setup]
  // Minimal Open Generative UI frontend: CopilotKitProvider registers the
  // built-in activity renderer, so a plain <CopilotChat /> is enough. No
  // custom tool renderers, no activity-renderer registration.
  // We DO pass `openGenerativeUI.designSkill` to swap in visualisation-tuned
  // guidance in place of the default shadcn design skill.
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("open-gen-ui")}
      agent="open-gen-ui"
      openGenerativeUI={{ designSkill }}
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl flex flex-col p-3">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
  // @endregion[minimal-provider-setup]
}

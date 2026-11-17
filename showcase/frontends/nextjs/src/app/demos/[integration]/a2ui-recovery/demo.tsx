"use client";

/**
 * A2UI Error Recovery demo.
 *
 * The same dynamic-schema A2UI setup as declarative-gen-ui, with the same
 * sales dashboard catalog, but it makes the validate and retry loop visible.
 * The agent validates each generated surface against the catalog. An invalid
 * render is retried with the validation errors, and when every attempt fails
 * the agent returns a recovery-exhausted result instead of a broken surface.
 *
 * The two pills drive aimock fixtures that force:
 * - heal: an invalid first render that recovers to a valid one;
 * - exhaust: a render that is invalid on every attempt, which ends in the
 *   "Couldn't generate the UI" failure state.
 */
import { CopilotKit } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";

import { A2UIFormatFrame } from "../_shared/a2ui-format-frame";
import { catalogsByProtocol } from "../_shared/a2ui-sales-dashboard/catalog";
import { Chat } from "./chat";
import type { A2uiRecoveryConfig } from "./config";

export function A2uiRecoveryDemo({ config }: { config: A2uiRecoveryConfig }) {
  const runtimeUrl = useDemoRuntimeUrl("a2ui-recovery");
  const catalog = catalogsByProtocol[config.catalogProtocol];
  return (
    <A2UIFormatFrame selector={config.formatSelector}>
      {(properties) => (
        <CopilotKit
          runtimeUrl={runtimeUrl}
          agent="a2ui-recovery"
          a2ui={{ catalog }}
          properties={properties}
        >
          <div className="flex justify-center items-center h-full w-full">
            <div className="h-full w-full max-w-4xl">
              <Chat prompts={config.prompts} />
            </div>
          </div>
        </CopilotKit>
      )}
    </A2UIFormatFrame>
  );
}

import type {
  InterruptAnswerKey,
  InterruptPayloadKey,
} from "./interrupt-payload";

/**
 * How an integration's agent asks the user to pick a meeting time. It is the
 * default export of `src/integrations/<slug>/demos/gen-ui-interrupt.ts`.
 *
 * - `frontend-tool`: the agent calls a `schedule_meeting` tool that the page
 *   registers. The user's pick goes back as the tool result.
 * - `interrupt`: the agent's own `schedule_meeting` tool pauses the run with
 *   an AG-UI interrupt. `payload` names where the bridge puts the meeting
 *   details, and `answer` names the value the bridge resumes the tool with.
 */
export type GenUiInterruptConfig =
  | { mechanism: "frontend-tool" }
  | {
      mechanism: "interrupt";
      payload: InterruptPayloadKey;
      answer: InterruptAnswerKey;
    };

/**
 * The setting for an integration with no file for this demo. A frontend tool
 * needs nothing from the agent except that it calls the tools the page
 * registers, so it works for any agent.
 */
export const DEFAULT_GEN_UI_INTERRUPT_CONFIG = {
  mechanism: "frontend-tool",
} satisfies GenUiInterruptConfig;

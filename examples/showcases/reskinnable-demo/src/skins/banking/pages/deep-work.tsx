"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { HARNESS_AGENT_ID } from "@/skins/banking/harness/types";

/**
 * ARM C's surface: a second chat, in the app card, pointed at the routed factory
 * agent (`harness-agent.ts`) while the shell's own assistant column keeps
 * talking to banking's classic agent. Two engines on screen at once is the
 * comparison — the honest way to see that Arm C's harness journey lands IN the
 * thread while Arm A's lands on a side channel.
 *
 * It renders `CopilotChat` DIRECTLY rather than reusing the shell's `ChatPanel`,
 * and that is a correction to the plan rather than a shortcut. The plan proposed
 * wrapping `<ChatPanel />` in a nested `CopilotChatConfigurationProvider` with
 * `agentId={HARNESS_AGENT_ID}`, on the (correct) reading that react-core resolves
 * `agentId ?? parentConfig?.agentId ?? DEFAULT`. But `ChatPanel` passes
 * `agentId={skin.id}` to `CopilotChat` EXPLICITLY (`shell/chat/chat-panel.tsx`),
 * and an explicit prop beats the inherited config every time — the nested
 * provider would have been overridden and every "harness" turn would have gone
 * to banking's classic agent instead. That failure is invisible: the page
 * renders, the chat answers, and only the absence of a harness gives it away.
 *
 * Two further reasons the direct form is better here: `ChatPanel` also renders
 * the shell's thread rail, which is bound to the shell's thread selection and
 * would list the OTHER agent's conversations beside this one; and this surface
 * wants its own fixed thread, not the shell's selected one.
 *
 * `.nw-chat` is not decoration — it scopes this subtree's markdown typography
 * (see globals.css). Without it, assistant messages silently fall back to the
 * library's default prose styling.
 */

/**
 * A FIXED thread id, so the harness conversation is stable across navigations
 * and does not appear in the shell's thread list. It is also the honest cost of
 * this arm on display: the two surfaces cannot see each other's history.
 */
const HARNESS_THREAD_ID = `${HARNESS_AGENT_ID}-thread`;

export default function DeepWorkPage() {
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <header>
        <h1 className="text-lg font-semibold text-ink">Deep work</h1>
        <p className="text-sm text-ink/60">
          A long-running agent with a shell, a filesystem, and web search. Give
          it a job that takes minutes — its thinking, tool calls and result all
          arrive as events on this thread, so a reload replays them.
        </p>
        <p className="mt-1 text-xs text-ink/50">
          Requires <code>EXPENSE_HARNESS_MODE=factory</code> (or{" "}
          <code>both</code>) on the server: the agent slot this page talks to is
          registered only under those modes.
        </p>
      </header>
      <div className="nw-chat min-h-0 flex-1 rounded-[--radius] border border-hairline bg-surface shadow-soft">
        <CopilotChat
          agentId={HARNESS_AGENT_ID}
          threadId={HARNESS_THREAD_ID}
          input={{ showDisclaimer: false }}
          labels={{
            modalHeaderTitle: "Deep work",
            welcomeMessageText:
              "Paste a job that takes minutes. The offsite expense statement is the worked example.",
          }}
        />
      </div>
    </div>
  );
}

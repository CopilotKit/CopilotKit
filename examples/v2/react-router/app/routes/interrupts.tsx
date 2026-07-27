import { useState } from "react";
import {
  CopilotKitProvider,
  CopilotChat,
  useInterrupt,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { InterruptCard } from "../components/InterruptCard";

type AgentType = "tanstack" | "aisdk";

/**
 * <CopilotChat> for one agent with AG-UI interrupts rendered INSIDE the chat.
 *
 * The `bookFlight` tool carries each SDK's native `needsApproval` flag, so
 * asking the agent to book a flight pauses the run as a standard AG-UI
 * interrupt. `useInterrupt({renderInChat:true})` drops the InterruptCard into
 * the conversation; resolving it resumes the run with the human's choice.
 *
 * The resolved payload is a real booking result (`{status:"booked"|"declined"}`)
 * rather than a bare approval flag — that's what the tool call "returns", so the
 * model treats each flight as settled instead of re-calling bookFlight in a loop.
 */
function InterruptChat({ agentType }: { agentType: AgentType }) {
  useConfigureSuggestions(
    {
      available: "always",
      consumerAgentId: agentType,
      suggestions: [
        { title: "Book 1 flight", message: "Book a flight to Tokyo" },
        { title: "Book 2 flights", message: "Book flights to Berlin and Rome" },
        {
          title: "Book 3 flights",
          message: "Book flights to Tokyo, Paris and London",
        },
      ],
    },
    [agentType],
  );

  useInterrupt({
    agentId: agentType,
    renderInChat: true,
    render: ({ interrupt, interrupts, resolve, cancel }) => {
      const list =
        interrupts.length > 0 ? interrupts : interrupt ? [interrupt] : [];
      return (
        <div className="flex flex-col gap-3 py-2">
          {list.map((it, i) => (
            <InterruptCard
              key={it.id}
              interrupt={it}
              index={i}
              total={list.length}
              onResolve={(payload) =>
                resolve(
                  (payload as { approved?: boolean })?.approved
                    ? { status: "booked" }
                    : { status: "declined" },
                  it.id,
                )
              }
              onCancel={() => cancel(it.id)}
            />
          ))}
        </div>
      );
    },
  });

  return (
    <CopilotChat
      agentId={agentType}
      className="h-full w-full"
      onError={(event) => console.error("[CopilotChat] Error:", event)}
    />
  );
}

export default function InterruptsRoute() {
  const [agentType, setAgentType] = useState<AgentType>("tanstack");

  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" showDevConsole="auto">
      <div className="flex h-screen w-screen flex-col">
        <header className="border-b bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-gray-800">
              Native interrupts
            </h1>
            <span className="text-sm font-medium text-gray-500">Agent:</span>
            <button
              onClick={() => setAgentType("aisdk")}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                agentType === "aisdk"
                  ? "bg-black text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              AI SDK
            </button>
            <button
              onClick={() => setAgentType("tanstack")}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                agentType === "tanstack"
                  ? "bg-black text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              TanStack AI
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            The <code>bookFlight</code> tool uses each SDK&apos;s native{" "}
            <code>needsApproval</code> flag → surfaces as an AG-UI interrupt
            in-chat. Try the suggestion pills below. Requires{" "}
            <code>OPENAI_API_KEY</code> on the server.
          </p>
        </header>
        <div className="flex-1 overflow-hidden">
          <InterruptChat key={agentType} agentType={agentType} />
        </div>
      </div>
    </CopilotKitProvider>
  );
}

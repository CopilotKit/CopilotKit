import { useState, useEffect, useRef } from "react";
import type { TicketMeta } from "../lib/ticket-types";
import { CopilotKit } from "@copilotkit/react-core";
import { useHumanInTheLoop } from "@copilotkit/react-core";
import { CopilotChat, useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";
import type { AgentSubscriber, Message } from "@ag-ui/client";

import "@copilotkit/react-core/v2/styles.css";

export const meta: TicketMeta = {
  title: "useAgent + HITL: tools not forwarded in request payload",
  refs: ["https://discord.com/channels/1122926057641742418/1471940831173804073"],
  notes:
    "CopilotChat includes tools in the request payload, but useAgent.runAgent() does not. " +
    "This breaks human-in-the-loop workflows when using useAgent directly.",
};

// ---------------------------------------------------------------------------
// Shared HITL tool — registered in both examples
// ---------------------------------------------------------------------------

function HITLTool() {
  console.log("[tkt-useagent-hitl] HITLTool component mounted — registering useHumanInTheLoop");

  useHumanInTheLoop({
    name: "confirmAction",
    description: "Ask the user to confirm or deny an action before proceeding.",
    parameters: [
      {
        name: "action",
        type: "string",
        description: "The action that needs confirmation",
        required: true,
      },
      {
        name: "reason",
        type: "string",
        description: "Why the action needs confirmation",
        required: true,
      },
    ],
    render: ({ args, status, respond, result }) => {
      console.log("[tkt-useagent-hitl] HITL render called", { status, args, result });

      if (status === "executing" && respond) {
        return (
          <div className="rounded-lg border-2 border-yellow-400 bg-yellow-50 p-4 my-2">
            <h4 className="font-semibold text-yellow-800 mb-2">Confirmation Required</h4>
            <p className="text-sm text-gray-700 mb-1">
              <strong>Action:</strong> {args.action}
            </p>
            <p className="text-sm text-gray-700 mb-3">
              <strong>Reason:</strong> {args.reason}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  console.log("[tkt-useagent-hitl] User clicked APPROVE");
                  respond({ confirmed: true, feedback: "Approved by user" });
                }}
                className="rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700"
              >
                Approve
              </button>
              <button
                onClick={() => {
                  console.log("[tkt-useagent-hitl] User clicked DENY");
                  respond({ confirmed: false, feedback: "Denied by user" });
                }}
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
              >
                Deny
              </button>
            </div>
          </div>
        );
      }

      if (status === "complete") {
        return (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 my-2 text-sm text-gray-600">
            Confirmation completed: {JSON.stringify(result)}
          </div>
        );
      }

      return (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 my-2 text-sm text-gray-500">
          Preparing confirmation...
        </div>
      );
    },
  });

  return null;
}

// ---------------------------------------------------------------------------
// Example A: CopilotChat (built-in chat) — tools ARE forwarded
// ---------------------------------------------------------------------------

function ExampleA_CopilotChat() {
  console.log("[tkt-useagent-hitl] ExampleA (CopilotChat) mounted");

  return (
    <CopilotKit runtimeUrl="/api/tickets/tkt-useagent-hitl/copilot" agent="default">
      <ExampleA_Inner />
    </CopilotKit>
  );
}

function ExampleA_Inner() {
  return (
    <div className="relative h-[600px] w-full">
      <HITLTool />
      <div className="p-4">
        <p className="text-sm text-gray-600">
          Using <code className="bg-gray-100 px-1 rounded">CopilotChat</code> (built-in chat). The
          HITL tool should appear in the request payload and work correctly.
        </p>
        <p className="text-sm text-gray-500 mt-2">
          Ask the agent: <em>"Please confirm an action for me"</em>
        </p>
      </div>
      <CopilotChat
        defaultOpen={true}
        labels={{
          modalHeaderTitle: "Example A: CopilotChat",
          welcomeMessageText:
            "I'm the agent using CopilotChat. Ask me to confirm an action to test HITL.",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Example B: useAgent + custom chat input — tools are NOT forwarded
// ---------------------------------------------------------------------------

function ExampleB_UseAgent() {
  console.log("[tkt-useagent-hitl] ExampleB (useAgent) mounted");

  return (
    <CopilotKit runtimeUrl="/api/tickets/tkt-useagent-hitl/copilot" agent="default">
      <ExampleB_Inner />
    </CopilotKit>
  );
}

function ExampleB_Inner() {
  const { agent } = useAgent({
    updates: [UseAgentUpdate.OnMessagesChanged],
  });
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.log("[tkt-useagent-hitl] ExampleB agent ref:", {
      agentId: agent?.agentId,
      threadId: agent?.threadId,
      isRunning: agent?.isRunning,
      messageCount: agent?.messages?.length,
    });
  }, [agent?.agentId, agent?.threadId, agent?.isRunning, agent?.messages?.length]);

  useEffect(() => {
    if (!agent) return;
    const subscriber: AgentSubscriber = {
      onRunStartedEvent: () => {
        console.log("[tkt-useagent-hitl] ExampleB: agent run started");
      },
      onRunFinishedEvent: () => {
        console.log("[tkt-useagent-hitl] ExampleB: agent run finished");
      },
      onMessagesChanged: () => {
        console.log("[tkt-useagent-hitl] ExampleB: messages changed", agent.messages.length);
      },
    };
    const sub = agent.subscribe(subscriber);
    return () => sub.unsubscribe();
  }, [agent]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agent?.messages?.length]);

  const handleSend = async () => {
    if (!input.trim() || !agent || agent.isRunning) return;
    const content = input.trim();
    setInput("");

    console.log("[tkt-useagent-hitl] ExampleB: sending message via useAgent", {
      content,
    });

    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content,
    });

    try {
      console.log("[tkt-useagent-hitl] ExampleB: calling agent.runAgent()");
      await agent.runAgent();
      console.log("[tkt-useagent-hitl] ExampleB: agent.runAgent() completed");
    } catch (err) {
      console.error("[tkt-useagent-hitl] ExampleB: agent.runAgent() error", err);
    }
  };

  return (
    <div className="h-[600px] w-full flex flex-col">
      <HITLTool />
      <div className="p-4">
        <p className="text-sm text-gray-600">
          Using <code className="bg-gray-100 px-1 rounded">useAgent</code> +{" "}
          <code className="bg-gray-100 px-1 rounded">agent.runAgent()</code> (custom chat). The HITL
          tool is NOT included in the request payload — HITL will not work.
        </p>
        <p className="text-sm text-gray-500 mt-2">
          Ask the agent: <em>"Please confirm an action for me"</em>
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 space-y-3">
        {agent?.messages?.map((msg: Message) => (
          <div
            key={msg.id}
            className={`p-3 rounded-lg text-sm ${
              msg.role === "user"
                ? "bg-blue-50 ml-8 text-blue-900"
                : "bg-gray-50 mr-8 text-gray-900"
            }`}
          >
            <div className="font-semibold text-xs mb-1 text-gray-500">{msg.role}</div>
            <div>{(msg as any).content || "[no text content]"}</div>
          </div>
        ))}
        {agent?.isRunning && (
          <div className="text-sm text-gray-400 italic">Agent is running...</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="flex gap-2 p-4 border-t"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={agent?.isRunning}
          placeholder="Type a message..."
          className="flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={!input.trim() || agent?.isRunning}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ticket component — toggle between examples (one at a time)
// ---------------------------------------------------------------------------

export default function TktUseagentHitl() {
  const [activeExample, setActiveExample] = useState<"A" | "B" | null>(null);

  console.log("[tkt-useagent-hitl] Active example:", activeExample);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-lg font-bold mb-2">useAgent + HITL: tools not forwarded</h2>
      <p className="text-sm text-gray-600 mb-4">
        This ticket reproduces the issue where <code>CopilotChat</code>/<code>CopilotChat</code>{" "}
        includes <code>tools</code> in the request payload (HITL works), but <code>useAgent</code> +{" "}
        <code>agent.runAgent()</code> does not include tools (HITL broken).
      </p>
      <p className="text-sm text-gray-500 mb-4">
        Select one example at a time to keep logs clean. Check the browser console and server logs
        for <code>[tkt-useagent-hitl]</code> prefixed output.
      </p>

      <div className="flex gap-3 mb-6">
        <button
          onClick={() => setActiveExample(activeExample === "A" ? null : "A")}
          className={`rounded-lg px-4 py-2 text-sm font-medium border ${
            activeExample === "A"
              ? "bg-green-600 text-white border-green-600"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          Example A: CopilotChat (works)
        </button>
        <button
          onClick={() => setActiveExample(activeExample === "B" ? null : "B")}
          className={`rounded-lg px-4 py-2 text-sm font-medium border ${
            activeExample === "B"
              ? "bg-red-600 text-white border-red-600"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          Example B: useAgent (broken)
        </button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        {activeExample === "A" && <ExampleA_CopilotChat />}
        {activeExample === "B" && <ExampleB_UseAgent />}
        {activeExample === null && (
          <div className="p-12 text-center text-gray-400 text-sm">
            Select an example above to start
          </div>
        )}
      </div>
    </div>
  );
}

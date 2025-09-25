"use client";

import { CatchAllActionRenderProps, useCoAgent, useCopilotAction, useLangGraphInterrupt } from "@copilotkit/react-core";
import { CopilotChat, CopilotKitCSSProperties } from "@copilotkit/react-ui";
import { ToolCall } from "@/registry/quickstarts/coagents-generic-lg/components/tool-call";
import { AgentState } from "@/registry/quickstarts/coagents-generic-lg/components/agent-state";
import { Interrupt } from "@/registry/quickstarts/coagents-generic-lg/components/interrupt";
import { HTMLAttributes } from "react";

export default function Page() {
  const { state, setState, running } = useCoAgent({
    name: process.env.NEXT_PUBLIC_COPILOTKIT_AGENT_NAME || "",
  });

  const chatStyles = running ? "w-2/3 border-r border-slate-200" : "w-1/2 h-1/2 mx-auto my-auto";

  return (
    <main className="flex h-screen bg-gradient-to-r from-indigo-200 to-pink-200">
      <Chat
        className={chatStyles}
        style={{
          "--copilot-kit-primary-color": "rgba(99, 102, 241, 0.8)",
        } as CopilotKitCSSProperties}
      />

      {running}

      {running && (
        <AgentState state={state} setState={setState} className="w-1/3 overflow-y-auto"/>
      )}
    </main>
  );
}

function Chat(props: HTMLAttributes<HTMLDivElement>) {
  const { running } = useCoAgent({
    name: process.env.NEXT_PUBLIC_COPILOTKIT_AGENT_NAME || "",
  });

  useLangGraphInterrupt({
    render: ({ event, result, resolve }) => 
      <Interrupt event={event} result={result} resolve={resolve} />
  });

  useCopilotAction({
    name: "*",
    render: ({ name, args, status, result }: CatchAllActionRenderProps) => {      
      return (
        <ToolCall name={name} args={args} status={status} result={result} />
      );
    },
  });

  return (
    <div {...props}>
      <CopilotChat
        onThumbsDown={() => { alert("Thumbs down"); }}
        onThumbsUp={() => { alert("Thumbs up"); }}
        className={running ? "h-full py-6" : "h-full py-6 rounded-xl"}
        labels={{
          initial: "Hi! I'm connected to your LangGraph agent. Ask me anything, and I'll show what's happening behind the scenes.",
          placeholder: "Type your message...",
        }}
      />
    </div>
  );
}

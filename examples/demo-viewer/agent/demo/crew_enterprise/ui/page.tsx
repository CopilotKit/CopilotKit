"use client";
/*
Full source available https://github.com/CopilotKit/CopilotKit/tree/main/examples/coagents-enterprise-crewai-crews/ui
This is for demonstration purpose only.
*/

import { useCoAgent, useCopilotChat } from "@copilotkit/react-core";
import { CopilotChat, ResponseStatus } from "@copilotkit/react-ui";
import { useEffect, useState } from "react";

interface AppState {
  inputs: {
    location: string;
  };
  result: string;
  status: ResponseStatus;
}

export default function Home() {
  const { appendMessage } = useCopilotChat();
  const [direction, setDirection] = useState<"horizontal" | "vertical">(
    "horizontal"
  );

  const { state, setState } = useCoAgent<AppState>({
    name: "restaurant_finder_agent",
    initialState: {
      inputs: {
        location: "New York",
      },
      result: "Final result will appear here",
    },
  });

  const setInput = async (key: keyof AppState["inputs"], value: string) => {
    setState({
      ...state,
      inputs: {
        ...state.inputs,
        [key]: value,
      },
    });
    await appendMessage({
      content: `My ${String(key)} is ${value}`,
      role: "Developer",
    });
  };

  return (
    <div className="w-full h-full relative">
      <div className="fixed bottom-4 right-4 z-50">
        <div>{state.status}</div>
      </div>

      <div className="w-full h-full">
        <div className="h-full relative overflow-y-auto">
          <CopilotChat
            instructions="Provide instructions here"
            className="h-full flex flex-col"
          />
        </div>
      </div>
    </div>
  );
}

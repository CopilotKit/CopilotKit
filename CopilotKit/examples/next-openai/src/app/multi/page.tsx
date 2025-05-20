"use client";

import { CopilotChat } from "@copilotkit/react-ui";
import "./styles.css";
import { CopilotKit, useCopilotAction } from "@copilotkit/react-core";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

interface BookableItem {
  name: string;
  arrivalDate: string;
  departureDate: string;
}

export default function PanelPage() {
  const searchParams = useSearchParams();
  const serviceAdapter = searchParams.get("serviceAdapter") || "openai";
  const runtimeUrl =
    searchParams.get("runtimeUrl") || `/api/copilotkit?serviceAdapter=${serviceAdapter}`;
  const publicApiKey = searchParams.get("publicApiKey");
  const copilotKitProps: Partial<React.ComponentProps<typeof CopilotKit>> = {
    runtimeUrl,
    publicApiKey: publicApiKey || undefined,
  };

  return (
    <CopilotKit {...copilotKitProps}>
      <TravelPlanner />
    </CopilotKit>
  );
}

function TravelPlanner() {
  const [bookableItems, setBookableItems] = useState<BookableItem[]>([]);

  // regular action
  useCopilotAction({
    name: "getFlight",
    followUp: false,
    render({ status, args }) {
      return <div>Flight</div>;
    },
  });
  
  // backend action
  useCopilotAction({
    name: "getImageUrl",
    render({ status, result, args }) {
      return <img src={result} alt="Image" />;
    },
  });
  

  // hitl action 1
  useCopilotAction({
    name: "getWeather",
    renderAndWaitForResponse({ status, args, respond }) {
      return (
        <div className="flex flex-col gap-2 bg-blue-500/50 p-4 border border-blue-500 rounded-md w-1/2">
          <p>Weather</p>
          <p>Status: {status}</p>
          {status !== "complete" && (
            <button className="bg-blue-500 text-white p-2 rounded-md" onClick={() => respond?.("the weather is 70 degrees")}>Continue</button>
          )}
        </div>
      );
    },
  });


  // hitl action 2
  useCopilotAction({
    name: "getHotel",
    renderAndWaitForResponse({ status, args, respond }) {
      return (
        <div className="flex flex-col gap-2 bg-blue-500/50 p-4 border border-blue-500 rounded-md w-1/2">
          <p>Hotel</p>
          <p>Status: {status}</p>
          {status !== "complete" && (
            <button className="bg-blue-500 text-white p-2 rounded-md" onClick={() => respond?.("Marriott")}>Continue</button>
          )}
        </div>
      );
    },
  });

  return (
    <div className="h-[500px] flex">
      <CopilotChat
        className="w-2/3 h-full border-r border-gray-200"
        labels={{
          initial: "Hi you! 👋 Let's book your next vacation. Ask me anything.",
        }}
        instructions="You are a travel planner. You help the user plan their vacation. After presenting something, don't summarize, but keep the reply short."
      />
    </div>
  );
}

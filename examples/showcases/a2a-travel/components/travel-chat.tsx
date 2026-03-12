"use client";

/**
 * Travel Chat Component
 *
 * Demonstrates key patterns:
 * - A2A Communication: Visualizes message flow between orchestrator and agents
 * - HITL: Trip requirements form and budget approval workflows
 * - Generative UI: Extracts structured data from agent responses
 * - Multi-Agent: Coordinates 4 agents across LangGraph + ADK via A2A Protocol
 */

import React, { useState, useEffect } from "react";
import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { useCopilotAction } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
import "./style.css";
import type {
  TravelChatProps,
  ItineraryData,
  BudgetData,
  WeatherData,
  RestaurantData,
  MessageActionRenderProps,
} from "./types";
import { MessageToA2A } from "./a2a/MessageToA2A";
import { MessageFromA2A } from "./a2a/MessageFromA2A";
import { TripRequirementsForm } from "./forms/TripRequirementsForm";
import { BudgetApprovalCard } from "./hitl/BudgetApprovalCard";
import { WeatherCard } from "./WeatherCard";

const ChatInner = ({
  onItineraryUpdate,
  onBudgetUpdate,
  onWeatherUpdate,
  onRestaurantUpdate,
}: TravelChatProps) => {
  const [approvalStates, setApprovalStates] = useState<
    Record<string, { approved: boolean; rejected: boolean }>
  >({});
  const { visibleMessages } = useCopilotChat();

  // Extract structured data from A2A agent responses
  useEffect(() => {
    const extractDataFromMessages = () => {
      for (const message of visibleMessages) {
        const msg = message as any;

        if (msg.type === "ResultMessage" && msg.actionName === "send_message_to_a2a_agent") {
          try {
            const result = msg.result;
            let parsed;

            if (typeof result === "string") {
              let cleanResult = result;
              if (result.startsWith("A2A Agent Response: ")) {
                cleanResult = result.substring("A2A Agent Response: ".length);
              }
              parsed = JSON.parse(cleanResult);
            } else if (typeof result === "object" && result !== null) {
              parsed = result;
            }

            if (parsed) {
              if (parsed.destination && parsed.itinerary && Array.isArray(parsed.itinerary)) {
                onItineraryUpdate?.(parsed as ItineraryData);
              }
              else if (parsed.totalBudget && parsed.breakdown && Array.isArray(parsed.breakdown)) {
                const budgetKey = `budget-${parsed.totalBudget}`;
                const isApproved = approvalStates[budgetKey]?.approved || false;
                if (isApproved) {
                  onBudgetUpdate?.(parsed as BudgetData);
                }
              }
              else if (parsed.destination && parsed.forecast && Array.isArray(parsed.forecast)) {
                const weatherDataParsed = parsed as WeatherData;
                onWeatherUpdate?.(weatherDataParsed);
              }
              else if (parsed.destination && parsed.meals && Array.isArray(parsed.meals)) {
                onRestaurantUpdate?.(parsed as RestaurantData);
              }
            }
          } catch (e) {
          }
        }
      }
    };

    extractDataFromMessages();
  }, [
    visibleMessages,
    approvalStates,
    onItineraryUpdate,
    onBudgetUpdate,
    onWeatherUpdate,
    onRestaurantUpdate,
  ]);

  // Register A2A message visualizer (renders green/blue communication boxes)
  useCopilotAction({
    name: "send_message_to_a2a_agent",
    description: "Sends a message to an A2A agent",
    available: "frontend",
    parameters: [
      {
        name: "agentName",
        type: "string",
        description: "The name of the A2A agent to send the message to",
      },
      {
        name: "task",
        type: "string",
        description: "The message to send to the A2A agent",
      },
    ],
    render: (actionRenderProps: MessageActionRenderProps) => {
      return (
        <>
          <MessageToA2A {...actionRenderProps} />
          <MessageFromA2A {...actionRenderProps} />
        </>
      );
    },
  });

  // Register HITL budget approval workflow (pauses agent until user approves/rejects)
  useCopilotAction(
    {
      name: "request_budget_approval",
      description: "Request user approval for the travel budget",
      parameters: [
        {
          name: "budgetData",
          type: "object",
          description: "The budget breakdown data requiring approval",
        },
      ],
      renderAndWaitForResponse: ({ args, respond }) => {
        if (!args.budgetData || typeof args.budgetData !== "object") {
          return <div className="text-xs text-gray-500 p-2">Loading budget data...</div>;
        }

        const budget = args.budgetData as BudgetData;

        if (!budget.totalBudget || !budget.breakdown) {
          return <div className="text-xs text-gray-500 p-2">Loading budget data...</div>;
        }

        const budgetKey = `budget-${budget.totalBudget}`;
        const currentState = approvalStates[budgetKey] || { approved: false, rejected: false };

        const handleApprove = () => {
          setApprovalStates((prev) => ({
            ...prev,
            [budgetKey]: { approved: true, rejected: false },
          }));
          respond?.({ approved: true, message: "Budget approved by user" });
        };

        const handleReject = () => {
          setApprovalStates((prev) => ({
            ...prev,
            [budgetKey]: { approved: false, rejected: true },
          }));
          respond?.({ approved: false, message: "Budget rejected by user" });
        };

        return (
          <BudgetApprovalCard
            budgetData={budget}
            isApproved={currentState.approved}
            isRejected={currentState.rejected}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        );
      },
    },
    [approvalStates]
  );

  // Register HITL trip requirements form (collects trip info at start)
  useCopilotAction({
    name: "gather_trip_requirements",
    description: "Gather trip requirements from the user (city, days, people, budget level)",
    parameters: [
      {
        name: "city",
        type: "string",
        description: "The destination city (may be pre-filled from user message)",
        required: false,
      },
      {
        name: "numberOfDays",
        type: "number",
        description: "Number of days for the trip (1-7)",
        required: false,
      },
      {
        name: "numberOfPeople",
        type: "number",
        description: "Number of people in the group (1-15)",
        required: false,
      },
      {
        name: "budgetLevel",
        type: "string",
        description: "Budget level: Economy, Comfort, or Premium",
        required: false,
      },
    ],
    renderAndWaitForResponse: ({ args, respond }) => {
      return <TripRequirementsForm args={args} respond={respond} />;
    },
  });

  // Display WeatherCard inline in chat (also shown in main content area)
  useCopilotAction({
    name: "display_weather_forecast",
    description: "Display weather forecast data as generative UI in the chat",
    available: "frontend",
    parameters: [
      {
        name: "weatherData",
        type: "object",
        description: "Weather forecast data to display",
      },
    ],
    render: ({ args }) => {
      if (!args.weatherData || typeof args.weatherData !== "object") {
        return <></>;
      }

      const weather = args.weatherData as WeatherData;

      if (!weather.destination || !weather.forecast || !Array.isArray(weather.forecast)) {
        return <></>;
      }

      return (
        <div className="my-3">
          <WeatherCard data={weather} />
        </div>
      );
    },
  });

  return (
    <div className="h-full">
      <CopilotChat
        className="h-full"
        labels={{
          initial:
            "👋 Hi! I'm your travel planning assistant.\n\nAsk me to plan a trip and I'll coordinate with specialized agents to create your perfect itinerary!",
        }}
        instructions="You are a helpful travel planning assistant. Help users plan their trips by coordinating with specialized agents."
      />
    </div>
  );
};

export default function TravelChat({
  onItineraryUpdate,
  onBudgetUpdate,
  onWeatherUpdate,
  onRestaurantUpdate,
}: TravelChatProps) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" showDevConsole={false} agent="a2a_chat">
      <ChatInner
        onItineraryUpdate={onItineraryUpdate}
        onBudgetUpdate={onBudgetUpdate}
        onWeatherUpdate={onWeatherUpdate}
        onRestaurantUpdate={onRestaurantUpdate}
      />
    </CopilotKit>
  );
}

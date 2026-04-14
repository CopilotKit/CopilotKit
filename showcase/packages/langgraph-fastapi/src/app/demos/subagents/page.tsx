"use client";

import React, { useEffect } from "react";
import { CopilotKit, useLangGraphInterrupt } from "@copilotkit/react-core";
import {
  CopilotSidebar,
  useAgent,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import {
  useShowcaseHooks,
  useShowcaseSuggestions,
  demonstrationCatalog,
} from "@copilotkit/showcase-shared";

interface Flight {
  airline: string;
  arrival: string;
  departure: string;
  duration: string;
  price: string;
}

interface Hotel {
  location: string;
  name: string;
  price_per_night: string;
  rating: string;
}

interface Experience {
  name: string;
  description: string;
  location: string;
  type: string;
}

interface Itinerary {
  hotel?: Hotel;
  flight?: Flight;
  experiences?: Experience[];
}

type AvailableAgents = "flights" | "hotels" | "experiences" | "supervisor";

interface TravelAgentState {
  experiences: Experience[];
  flights: Flight[];
  hotels: Hotel[];
  itinerary: Itinerary;
  planning_step: string;
  active_agent: AvailableAgents;
}

const INITIAL_STATE: TravelAgentState = {
  itinerary: {},
  experiences: [],
  flights: [],
  hotels: [],
  planning_step: "start",
  active_agent: "supervisor",
};

interface InterruptEvent<TAgent extends AvailableAgents> {
  message: string;
  options: TAgent extends "flights"
    ? Flight[]
    : TAgent extends "hotels"
      ? Hotel[]
      : never;
  recommendation: TAgent extends "flights"
    ? Flight
    : TAgent extends "hotels"
      ? Hotel
      : never;
  agent: TAgent;
}

export default function SubagentsDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="subagents"
      a2ui={{ catalog: demonstrationCatalog }}
    >
      <div className="min-h-screen w-full flex">
        <TravelPlanner />
        <CopilotSidebar
          agentId="subagents"
          defaultOpen={true}
          labels={{
            modalHeaderTitle: "Travel Planning Assistant",
          }}
        />
      </div>
    </CopilotKit>
  );
}

function InterruptHumanInTheLoop<TAgent extends AvailableAgents>({
  event,
  resolve,
}: {
  event: { value: InterruptEvent<TAgent> };
  resolve: (value: string) => void;
}) {
  const { message, options, agent, recommendation } = event.value;

  const formatAgentName = (agentName: string) => {
    switch (agentName) {
      case "flights":
        return "Flights Agent";
      case "hotels":
        return "Hotels Agent";
      case "experiences":
        return "Experiences Agent";
      default:
        return `${agentName} Agent`;
    }
  };

  const handleOptionSelect = (option: Flight | Hotel) => {
    resolve(JSON.stringify(option));
  };

  return (
    <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 my-3">
      <p className="font-medium mb-3">
        {formatAgentName(agent)}: {message}
      </p>
      <div className="space-y-2">
        {options.map((opt, idx) => {
          if ("airline" in opt) {
            const isRecommended =
              (recommendation as Flight).airline === opt.airline;
            return (
              <button
                key={idx}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  isRecommended
                    ? "border-yellow-400 bg-yellow-50 hover:bg-yellow-100"
                    : "border-gray-200 bg-white hover:bg-gray-50"
                }`}
                onClick={() => handleOptionSelect(opt)}
              >
                {isRecommended && (
                  <span className="text-xs font-semibold text-yellow-600 mb-1 block">
                    Recommended
                  </span>
                )}
                <div className="flex justify-between items-center">
                  <span className="font-medium">{opt.airline}</span>
                  <span className="text-green-600 font-semibold">
                    {opt.price}
                  </span>
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  {opt.departure} &rarr; {opt.arrival}
                </div>
                <div className="text-xs text-gray-500">{opt.duration}</div>
              </button>
            );
          }

          const isRecommended = (recommendation as Hotel).name === opt.name;
          return (
            <button
              key={idx}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                isRecommended
                  ? "border-yellow-400 bg-yellow-50 hover:bg-yellow-100"
                  : "border-gray-200 bg-white hover:bg-gray-50"
              }`}
              onClick={() => handleOptionSelect(opt)}
            >
              {isRecommended && (
                <span className="text-xs font-semibold text-yellow-600 mb-1 block">
                  Recommended
                </span>
              )}
              <div className="flex justify-between items-center">
                <span className="font-medium">{opt.name}</span>
                <span className="text-sm">{opt.rating}</span>
              </div>
              <div className="text-sm text-gray-600 mt-1">{opt.location}</div>
              <div className="text-xs text-gray-500">{opt.price_per_night}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TravelPlanner() {
  const { agent } = useAgent({
    agentId: "subagents",
    updates: [UseAgentUpdate.OnStateChanged],
  });

  const agentState = agent.state as TravelAgentState | undefined;

  useShowcaseHooks();
  useShowcaseSuggestions();

  useEffect(() => {
    if (!agentState) {
      agent.setState(INITIAL_STATE);
    }
  }, []);

  useLangGraphInterrupt({
    render: ({ event, resolve }) => (
      <InterruptHumanInTheLoop event={event} resolve={resolve} />
    ),
  });

  const activeAgent = agentState?.active_agent || "supervisor";

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-100">
        <div className="text-sm font-semibold text-gray-500 mb-2">
          Current Itinerary
        </div>
        <div className="flex flex-wrap gap-3">
          {agentState?.itinerary?.flight && (
            <div
              data-testid="selected-flight"
              className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg shadow-sm text-sm"
            >
              <span>{"✈"}</span>
              <span>
                {agentState.itinerary.flight.airline} -{" "}
                {agentState.itinerary.flight.price}
              </span>
            </div>
          )}
          {agentState?.itinerary?.hotel && (
            <div
              data-testid="selected-hotel"
              className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg shadow-sm text-sm"
            >
              <span>{"🏨"}</span>
              <span>{agentState.itinerary.hotel.name}</span>
            </div>
          )}
          {(agentState?.experiences?.length ?? 0) > 0 && (
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg shadow-sm text-sm">
              <span>{"🎯"}</span>
              <span>
                {agentState?.experiences?.length ?? 0} experiences planned
              </span>
            </div>
          )}
          {!agentState?.itinerary?.flight &&
            !agentState?.itinerary?.hotel &&
            (agentState?.experiences?.length ?? 0) === 0 && (
              <span className="text-sm text-gray-400">
                No items yet -- start planning!
              </span>
            )}
        </div>
      </div>

      <div className="mb-6">
        <div className="text-sm font-semibold text-gray-500 mb-2">
          Active Agent
        </div>
        <div className="flex gap-2">
          {(
            [
              { id: "supervisor", icon: "👨‍💼", label: "Supervisor" },
              { id: "flights", icon: "✈", label: "Flights" },
              { id: "hotels", icon: "🏨", label: "Hotels" },
              { id: "experiences", icon: "🎯", label: "Experiences" },
            ] as const
          ).map((a) => (
            <div
              key={a.id}
              data-testid={`${a.id}-indicator`}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all ${
                activeAgent === a.id
                  ? "bg-blue-100 text-blue-700 font-semibold border border-blue-300"
                  : "bg-gray-50 text-gray-500 border border-gray-200"
              }`}
            >
              <span>{a.icon}</span>
              <span>{a.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        <div>
          <h4 className="text-md font-semibold mb-2">{"✈"} Flight Options</h4>
          {(agentState?.flights?.length ?? 0) > 0 ? (
            <div className="space-y-2">
              {agentState!.flights.map((flight, index) => (
                <div key={index} className="p-3 bg-gray-50 rounded-lg text-sm">
                  <strong>{flight.airline}:</strong> {flight.departure} &rarr;{" "}
                  {flight.arrival} ({flight.duration}) - {flight.price}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No flights found yet</p>
          )}
        </div>

        <div>
          <h4 className="text-md font-semibold mb-2">{"🏨"} Hotel Options</h4>
          {(agentState?.hotels?.length ?? 0) > 0 ? (
            <div className="space-y-2">
              {agentState!.hotels.map((hotel, index) => (
                <div key={index} className="p-3 bg-gray-50 rounded-lg text-sm">
                  <strong>{hotel.name}:</strong> {hotel.location} -{" "}
                  {hotel.price_per_night} ({hotel.rating})
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No hotels found yet</p>
          )}
        </div>

        <div>
          <h4 className="text-md font-semibold mb-2">{"🎯"} Experiences</h4>
          {(agentState?.experiences?.length ?? 0) > 0 ? (
            <div className="space-y-2">
              {agentState!.experiences.map((experience, index) => (
                <div key={index} className="p-3 bg-gray-50 rounded-lg">
                  <div className="font-medium text-sm">{experience.name}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {experience.type} -- {experience.location}
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    {experience.description}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No experiences planned yet</p>
          )}
        </div>
      </div>
    </div>
  );
}

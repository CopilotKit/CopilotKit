"use client";

import { useState } from "react";
import TravelChat from "@/components/travel-chat";
import { ItineraryCard, type ItineraryData } from "@/components/ItineraryCard";
import { BudgetBreakdown, type BudgetData } from "@/components/BudgetBreakdown";
import { WeatherCard, type WeatherData } from "@/components/WeatherCard";
import { type RestaurantData } from "@/components/ItineraryCard";

export default function Home() {
  const [itineraryData, setItineraryData] = useState<ItineraryData | null>(null);
  const [budgetData, setBudgetData] = useState<BudgetData | null>(null);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [restaurantData, setRestaurantData] = useState<RestaurantData | null>(null);

  return (
    <div className="relative flex h-screen overflow-hidden bg-[#DEDEE9] p-2">
      <div className="absolute w-[445.84px] h-[445.84px] left-[1040px] top-[11px] rounded-full z-0"
           style={{ background: 'rgba(255, 172, 77, 0.2)', filter: 'blur(103.196px)' }} />
      <div className="absolute w-[609.35px] h-[609.35px] left-[1338.97px] top-[624.5px] rounded-full z-0"
           style={{ background: '#C9C9DA', filter: 'blur(103.196px)' }} />
      <div className="absolute w-[609.35px] h-[609.35px] left-[670px] top-[-365px] rounded-full z-0"
           style={{ background: '#C9C9DA', filter: 'blur(103.196px)' }} />
      <div className="absolute w-[609.35px] h-[609.35px] left-[507.87px] top-[702.14px] rounded-full z-0"
           style={{ background: '#F3F3FC', filter: 'blur(103.196px)' }} />
      <div className="absolute w-[445.84px] h-[445.84px] left-[127.91px] top-[331px] rounded-full z-0"
           style={{ background: 'rgba(255, 243, 136, 0.3)', filter: 'blur(103.196px)' }} />
      <div className="absolute w-[445.84px] h-[445.84px] left-[-205px] top-[802.72px] rounded-full z-0"
           style={{ background: 'rgba(255, 172, 77, 0.2)', filter: 'blur(103.196px)' }} />

      <div className="flex flex-1 overflow-hidden z-10 gap-2">
        <div className="w-[450px] flex-shrink-0 border-2 border-white bg-white/50 backdrop-blur-md shadow-elevation-lg flex flex-col rounded-lg overflow-hidden">
          <div className="p-6 border-b border-[#DBDBE5]">
          <h1 className="text-2xl font-semibold text-[#010507] mb-1">Travel Planning</h1>
          <p className="text-sm text-[#57575B] leading-relaxed">
            Multi-Agent A2A Demo:{" "}
            <span className="text-[#1B936F] font-semibold">2 LangGraph</span> +{" "}
            <span className="text-[#BEC2FF] font-semibold">2 ADK</span> agents
          </p>
          <p className="text-xs text-[#838389] mt-1">Orchestrator-mediated A2A Protocol</p>
        </div>

        <div className="flex-1 overflow-hidden">
          <TravelChat
            onItineraryUpdate={setItineraryData}
            onBudgetUpdate={setBudgetData}
            onWeatherUpdate={setWeatherData}
            onRestaurantUpdate={setRestaurantData}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto rounded-lg bg-white/30 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto p-8">
          <div className="mb-8">
            <h2 className="text-3xl font-semibold text-[#010507] mb-2">Your Travel Plan</h2>
            <p className="text-[#57575B]">
              Multi-agent coordination: 2 LangGraph + 2 ADK agents with A2A Protocol and
              human-in-the-loop approval
            </p>
          </div>

          {!itineraryData && !budgetData && !weatherData && (
            <div className="flex items-center justify-center h-[400px] bg-white/60 backdrop-blur-md rounded-xl border-2 border-dashed border-[#DBDBE5] shadow-elevation-sm">
              <div className="text-center">
                <div className="text-6xl mb-4">✈️</div>
                <h3 className="text-xl font-semibold text-[#010507] mb-2">
                  Start Planning Your Trip
                </h3>
                <p className="text-[#57575B] max-w-md">
                  Ask the assistant to plan a trip. Watch as 4 specialized agents collaborate
                  through A2A Protocol to create your personalized plan.
                </p>
              </div>
            </div>
          )}

          {itineraryData && (
            <div className="mb-4">
              <ItineraryCard data={itineraryData} restaurantData={restaurantData} />
            </div>
          )}

          {(weatherData || budgetData) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {weatherData && (
                <div>
                  <WeatherCard data={weatherData} />
                </div>
              )}

              {budgetData && (
                <div>
                  <BudgetBreakdown data={budgetData} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

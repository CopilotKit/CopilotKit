"use client";

import { useFrontendTool, useHumanInTheLoop } from "@copilotkitnext/react";
import { z } from "zod";
import { WeatherCard, WeatherLoadingState } from "./static-tools/WeatherCard";
import { StockCard, StockLoadingState } from "./static-tools/StockCard";
import { TaskApprovalCard } from "./static-tools/TaskApprovalCard";

// Type definitions for tool results
// CopilotKit parses results at runtime, but TypeScript types them as string
type WeatherData = {
  location: string;
  temperature: number;
  conditions: string;
  humidity: number;
  windSpeed: number;
};

type StockData = {
  symbol: string;
  companyName: string;
  price: number;
  change: number;
  changePercent: number;
  priceHistory: number[];
};

type ApprovalResult = {
  approved: boolean;
};

// Mock weather data generator
function getMockWeather(location: string): WeatherData {
  const conditions = ["Sunny", "Partly Cloudy", "Cloudy", "Light Rain", "Clear"];
  const condition = conditions[Math.floor(Math.random() * conditions.length)];
  return {
    location,
    temperature: Math.floor(Math.random() * 40) + 50, // 50-90°F
    conditions: condition,
    humidity: Math.floor(Math.random() * 50) + 30, // 30-80%
    windSpeed: Math.floor(Math.random() * 20) + 5, // 5-25 mph
  };
}

// Mock stock data generator
function getMockStock(symbol: string): StockData {
  const companies: Record<string, string> = {
    AAPL: "Apple Inc.",
    GOOGL: "Alphabet Inc.",
    MSFT: "Microsoft Corporation",
    AMZN: "Amazon.com Inc.",
    TSLA: "Tesla Inc.",
  };
  const basePrice = Math.random() * 300 + 100;
  const change = (Math.random() - 0.5) * 20;
  const history = Array.from({ length: 20 }, () => basePrice + (Math.random() - 0.5) * 30);

  return {
    symbol: symbol.toUpperCase(),
    companyName: companies[symbol.toUpperCase()] || `${symbol.toUpperCase()} Corp`,
    price: Math.round(basePrice * 100) / 100,
    change: Math.round(change * 100) / 100,
    changePercent: Math.round((change / basePrice) * 10000) / 100,
    priceHistory: history,
  };
}

/**
 * CopilotContextProvider - Registers all Static GenUI tools
 *
 * This component demonstrates CopilotKit's Static GenUI pattern where:
 * - Pre-built React components are defined in the frontend
 * - useFrontendTool: Defines callable tools with handlers and custom rendering
 * - useHumanInTheLoop: Interactive prompts requiring user input
 */
export function CopilotContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Weather tool - callable tool that displays weather data in a styled card
  useFrontendTool({
    name: "get_weather",
    description: "Get current weather information for a location",
    parameters: z.object({
      location: z.string().describe("The city or location to get weather for"),
    }),
    handler: async ({ location }) => {
      // Simulate API delay
      await new Promise((resolve) => setTimeout(resolve, 500));
      return getMockWeather(location);
    },
    render: ({ status, args, result }) => {
      if (status === "inProgress" || status === "executing") {
        return <WeatherLoadingState location={args?.location} />;
      }

      if (status === "complete" && result) {
        // Result is a JSON string - parse it to get actual object
        const data = JSON.parse(result) as WeatherData;
        return (
          <WeatherCard
            location={data.location}
            temperature={data.temperature}
            conditions={data.conditions}
            humidity={data.humidity}
            windSpeed={data.windSpeed}
          />
        );
      }

      return <></>;
    },
  });

  // Stock tool - callable tool that displays stock price with sparkline chart
  useFrontendTool({
    name: "get_stock",
    description: "Get current stock price and information for a symbol",
    parameters: z.object({
      symbol: z.string().describe("The stock ticker symbol (e.g., AAPL, GOOGL)"),
    }),
    handler: async ({ symbol }) => {
      // Simulate API delay
      await new Promise((resolve) => setTimeout(resolve, 500));
      return getMockStock(symbol);
    },
    render: ({ status, args, result }) => {
      if (status === "inProgress" || status === "executing") {
        return <StockLoadingState symbol={args?.symbol} />;
      }

      if (status === "complete" && result) {
        // Result is a JSON string - parse it to get actual object
        const data = JSON.parse(result) as StockData;
        return (
          <StockCard
            symbol={data.symbol}
            price={data.price}
            change={data.change}
            changePercent={data.changePercent}
            priceHistory={data.priceHistory}
            companyName={data.companyName}
          />
        );
      }

      return <></>;
    },
  });

  // Task approval - human-in-the-loop pattern for task confirmation
  useHumanInTheLoop({
    name: "approve_task",
    description: "Request user approval for a task before executing it",
    parameters: z.object({
      taskTitle: z.string().describe("The title of the task requiring approval"),
      taskDescription: z.string().describe("Detailed description of what the task will do"),
      impact: z.string().describe("The impact or scope of the task").optional(),
    }),
    render: ({ args, status, respond, result }) => {
      // Show approval UI when waiting for user input
      if (status === "executing" && respond) {
        return (
          <TaskApprovalCard
            taskTitle={args.taskTitle}
            taskDescription={args.taskDescription}
            impact={args.impact}
            onApprove={() => respond({ approved: true })}
            onReject={() => respond({ approved: false })}
          />
        );
      }

      // Show result after user has responded
      if (status === "complete" && result) {
        // Result is a JSON string - parse it to get actual object
        const data = JSON.parse(result) as ApprovalResult;
        return (
          <div className="glass-card p-4">
            <div className="flex items-center gap-2">
              {data.approved ? (
                <>
                  <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-green-600">Task Approved</span>
                </>
              ) : (
                <>
                  <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center">
                    <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-red-600">Task Rejected</span>
                </>
              )}
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-2">
              {args?.taskTitle}
            </p>
          </div>
        );
      }

      // Return empty fragment for other states (inProgress, etc.)
      return <></>;
    },
  });

  return <>{children}</>;
}

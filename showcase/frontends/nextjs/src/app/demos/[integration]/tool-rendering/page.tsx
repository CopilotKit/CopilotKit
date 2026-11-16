"use client";

// Tool Rendering: PRIMARY (per-tool + catch-all) variant.
//
// The most sophisticated point in the three-way progression: every
// "interesting" backend tool gets its own dedicated, branded UI, and a
// catch-all paints anything that slips through.
//
//   get_weather     -> <WeatherCard />            (per-tool renderer)
//   search_flights  -> <FlightListCard />         (per-tool renderer)
//   get_stock_price -> <StockCard />              (per-tool renderer)
//   roll_d20        -> <D20Card />                (per-tool renderer)
//   *               -> <CustomCatchallRenderer /> (wildcard fallback)
//
// A weather result that is not a complete weather report shows an error
// card with a Retry button instead of an empty weather card. Retry sends the
// user prompt that led to the call again, through the chat's normal submit
// handler. The button is disabled while a run is active.

// @region[render-flight-tool]
// @region[render-weather-tool]
import React from "react";
import {
  CopilotKit,
  CopilotChat,
  CopilotChatView,
  useRenderTool,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { WeatherCard } from "./weather-card";
import { FlightListCard } from "./flight-list-card";
import type { Flight } from "./flight-list-card";
import { StockCard } from "./stock-card";
import { D20Card } from "./d20-card";
import { CustomCatchallRenderer } from "./custom-catchall-renderer";
import { parseJsonResult } from "../_shared/parse-json-result";
import { useSuggestions } from "./suggestions";

// A complete weather report. Any other result is a failed lookup.
const weatherResultSchema = z.object({
  city: z.string(),
  temperature: z.number(),
  humidity: z.number(),
  wind_speed: z.number(),
  conditions: z.string(),
});

type WeatherResult = Partial<z.infer<typeof weatherResultSchema>>;

type ChatViewProps = React.ComponentProps<typeof CopilotChatView>;
type ChatMessages = NonNullable<ChatViewProps["messages"]>;

// Lets a tool card send the user prompt that led to its call again.
interface RetryControls {
  retry: (toolCallId: string) => void;
  canRetry: (toolCallId: string) => boolean;
}

const NO_RETRY: RetryControls = {
  retry: () => {},
  canRetry: () => false,
};

const RetryContext = React.createContext(NO_RETRY);

// The text of the last user message before the assistant message that made
// this tool call.
function promptForToolCall(messages: ChatMessages, toolCallId: string) {
  const callIndex = messages.findLastIndex(
    (message) =>
      message.role === "assistant" &&
      message.toolCalls?.some((call) => call.id === toolCallId),
  );
  for (let index = callIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      return typeof message.content === "string" ? message.content : undefined;
    }
  }
  return undefined;
}

// The stock chat view, wrapped in RetryContext so tool cards can retry.
function RetryChatView(props: ChatViewProps) {
  const { messages = [], isRunning, onSubmitMessage } = props;
  const canRetry = (toolCallId: string) => {
    const prompt = promptForToolCall(messages, toolCallId);
    const hasPrompt = prompt !== undefined && prompt.trim() !== "";
    return !isRunning && onSubmitMessage !== undefined && hasPrompt;
  };
  const retry = (toolCallId: string) => {
    const prompt = promptForToolCall(messages, toolCallId);
    if (prompt !== undefined && canRetry(toolCallId)) {
      onSubmitMessage?.(prompt);
    }
  };
  return (
    <RetryContext.Provider value={{ retry, canRetry }}>
      <CopilotChatView {...props} />
    </RetryContext.Provider>
  );
}

function WeatherFailure({ toolCallId }: { toolCallId: string }) {
  const { retry, canRetry } = React.useContext(RetryContext);
  return (
    <div
      role="alert"
      className="my-4 w-full max-w-md rounded-2xl border border-[#DBDBE5] dark:border-border bg-[#EDEDF5] dark:bg-muted p-5 text-[#010507] dark:text-foreground"
    >
      <p className="font-semibold">Weather lookup failed.</p>
      <p className="mt-1 text-sm text-[#57575B] dark:text-muted-foreground">
        Retry to request the weather again.
      </p>
      <button
        type="button"
        className="mt-3 rounded-lg border border-[#57575B] dark:border-muted-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        disabled={!canRetry(toolCallId)}
        onClick={() => retry(toolCallId)}
      >
        Retry
      </button>
    </div>
  );
}

interface FlightSearchResult {
  origin?: string;
  destination?: string;
  flights?: Flight[];
}

interface StockResult {
  ticker?: string;
  price_usd?: number;
  change_pct?: number;
}

interface D20Result {
  value?: number;
  result?: number;
  sides?: number;
}

export default function ToolRenderingDemo() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("tool-rendering")}
      agent="tool-rendering"
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  // Per-tool renderer #1: get_weather -> branded WeatherCard.
  useRenderTool(
    {
      name: "get_weather",
      parameters: z.object({
        location: z.string(),
      }),
      render: ({ parameters, result, status, toolCallId }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<WeatherResult>(result);
        const failed =
          !loading && !weatherResultSchema.safeParse(parsed).success;
        if (failed) {
          return <WeatherFailure toolCallId={toolCallId} />;
        }
        return (
          <WeatherCard
            loading={loading}
            location={parameters?.location ?? parsed.city ?? ""}
            temperature={parsed.temperature}
            humidity={parsed.humidity}
            windSpeed={parsed.wind_speed}
            conditions={parsed.conditions}
          />
        );
      },
    },
    [],
  );
  // @endregion[render-weather-tool]

  // Per-tool renderer #2: search_flights -> branded FlightListCard.
  useRenderTool(
    {
      name: "search_flights",
      parameters: z.object({
        origin: z.string(),
        destination: z.string(),
      }),
      render: ({ parameters, result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<FlightSearchResult>(result);
        return (
          <FlightListCard
            loading={loading}
            origin={parameters?.origin ?? parsed.origin ?? ""}
            destination={parameters?.destination ?? parsed.destination ?? ""}
            flights={parsed.flights ?? []}
          />
        );
      },
    },
    [],
  );
  // @endregion[render-flight-tool]

  // Per-tool renderer #3: get_stock_price -> branded StockCard.
  useRenderTool(
    {
      name: "get_stock_price",
      parameters: z.object({
        ticker: z.string(),
      }),
      render: ({ parameters, result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<StockResult>(result);
        return (
          <StockCard
            loading={loading}
            ticker={parameters?.ticker ?? parsed.ticker ?? ""}
            priceUsd={parsed.price_usd}
            changePct={parsed.change_pct}
          />
        );
      },
    },
    [],
  );

  // Per-tool renderer #4: roll_d20 -> branded D20Card. Each tool call
  // mounts its own card so e2e tests can count them.
  useRenderTool(
    {
      name: "roll_d20",
      parameters: z.object({
        value: z.number().optional(),
      }),
      render: ({ result, status }) => {
        const loading = status !== "complete";
        const parsed = parseJsonResult<D20Result>(result);
        const value =
          typeof parsed.value === "number"
            ? parsed.value
            : typeof parsed.result === "number"
              ? parsed.result
              : undefined;
        return <D20Card loading={loading} value={value} />;
      },
    },
    [],
  );

  // @region[catchall-renderer]
  // Wildcard catch-all for anything that doesn't match a per-tool
  // renderer above.
  useDefaultRenderTool(
    {
      render: ({ name, parameters, status, result }) => (
        <CustomCatchallRenderer
          name={name}
          parameters={parameters}
          status={status}
          result={result}
        />
      ),
    },
    [],
  );
  // @endregion[catchall-renderer]

  useSuggestions();

  return (
    <CopilotChat
      agentId="tool-rendering"
      chatView={RetryChatView}
      className="h-full rounded-2xl"
    />
  );
}

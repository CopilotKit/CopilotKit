"use client";

import React, { FormEvent, useMemo, useState } from "react";
import { CopilotKit, useCopilotChatHeadless_c } from "@copilotkit/react-core";
import {
  useRenderTool,
  useToolRenderingResolver,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

const PUBLIC_API_KEY =
  process.env.NEXT_PUBLIC_COPILOTKIT_PUBLIC_API_KEY ||
  process.env.NEXT_PUBLIC_COPILOTKIT_PUBLIC_LICENSE_KEY ||
  "ck_pub_showcase_headless_local";

export default function HeadlessUIDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="headless-complete"
      publicApiKey={PUBLIC_API_KEY}
    >
      <HeadlessChat />
    </CopilotKit>
  );
}

function HeadlessChat() {
  const { messages, sendMessage, isLoading } = useCopilotChatHeadless_c();
  const resolveToolRendering = useToolRenderingResolver();
  const [input, setInput] = useState("");

  useRenderTool({
    name: "get_weather",
    parameters: z.object({
      location: z.string(),
    }),
    render: ({ parameters, result, status }) => {
      if (status !== "complete") {
        return (
          <div
            data-testid="headless-weather-loading"
            className="flex items-center gap-3 rounded-2xl px-5 py-4 text-white shadow-lg"
            style={{
              background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)",
            }}
          >
            <div className="text-2xl">🌤️</div>
            <div>
              <p className="text-sm font-semibold">Checking weather...</p>
              <p className="text-xs text-white/70">
                {parameters.location ?? "the selected location"}
              </p>
            </div>
          </div>
        );
      }

      const weather = parseWeatherResult(result);

      return (
        <WeatherCard
          location={parameters.location ?? weather.city ?? "Unknown location"}
          temperature={weather.temperature ?? 22}
          conditions={weather.conditions || "Clear skies"}
          humidity={weather.humidity ?? 55}
          windSpeed={weather.wind_speed ?? weather.windSpeed ?? 12}
          feelsLike={
            weather.feels_like ?? weather.feelsLike ?? weather.temperature ?? 22
          }
        />
      );
    },
  });

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.role !== "tool"),
    [messages],
  );

  async function submitMessage(message = input) {
    const content = message.trim();
    if (!content || isLoading) return;

    setInput("");
    await sendMessage({
      id: crypto.randomUUID(),
      role: "user",
      content,
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitMessage();
  }

  return (
    <main
      data-testid="headless-chat"
      className="min-h-screen bg-[#f8fafc] px-4 py-6 text-slate-950"
    >
      <section className="mx-auto flex h-[calc(100vh-3rem)] max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <header className="border-b border-slate-200 px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
            Weather Assistant
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-normal">
            Ask for the weather in any city
          </h1>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {visibleMessages.length === 0 ? (
            <div className="flex h-full flex-col justify-center gap-4">
              <p className="max-w-xl text-sm leading-6 text-slate-600">
                Try a weather question and the assistant will answer in chat
                while showing the forecast as a custom card.
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  "What's the weather like in Lisbon?",
                  "Check the weather in Tokyo.",
                ].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-blue-400 hover:text-blue-700"
                    onClick={() => void submitMessage(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {visibleMessages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  messages={messages}
                  resolveToolRendering={resolveToolRendering}
                />
              ))}
              {isLoading && (
                <div
                  data-testid="headless-loading"
                  className="text-sm text-slate-500"
                >
                  Assistant is working...
                </div>
              )}
            </div>
          )}
        </div>

        <form
          className="flex gap-3 border-t border-slate-200 bg-slate-50 p-4"
          onSubmit={handleSubmit}
        >
          <input
            className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            placeholder="Ask the headless chat about the weather"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <button
            type="submit"
            disabled={isLoading || input.trim().length === 0}
            className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Send
          </button>
        </form>
      </section>
    </main>
  );
}

type HeadlessMessage = ReturnType<
  typeof useCopilotChatHeadless_c
>["messages"][number];
type AssistantMessage = Extract<HeadlessMessage, { role: "assistant" }>;
type ToolMessage = Extract<HeadlessMessage, { role: "tool" }>;
type ToolRenderingResolver = ReturnType<typeof useToolRenderingResolver>;

function MessageBubble({
  message,
  messages,
  resolveToolRendering,
}: {
  message: HeadlessMessage;
  messages: HeadlessMessage[];
  resolveToolRendering: ToolRenderingResolver;
}) {
  const isUser = message.role === "user";
  const text = getMessageText(message);

  return (
    <article
      data-role={message.role}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
          isUser
            ? "bg-blue-600 text-white"
            : "border border-slate-200 bg-slate-50 text-slate-800"
        }`}
      >
        {text && <p className="whitespace-pre-wrap leading-6">{text}</p>}
        {message.role === "assistant" && (
          <ResolvedToolCalls
            message={message}
            messages={messages}
            resolveToolRendering={resolveToolRendering}
          />
        )}
      </div>
    </article>
  );
}

function ResolvedToolCalls({
  message,
  messages,
  resolveToolRendering,
}: {
  message: AssistantMessage;
  messages: HeadlessMessage[];
  resolveToolRendering: ToolRenderingResolver;
}) {
  if (!message.toolCalls?.length) return null;

  return (
    <div className="mt-3 space-y-3" data-testid="headless-tool-renderings">
      {message.toolCalls.map((toolCall) => {
        const toolMessage = messages.find(
          (candidate): candidate is ToolMessage =>
            isToolMessageForCall(candidate, toolCall.id),
        );
        const renderedToolElement = resolveToolRendering({
          toolCall,
          toolMessage,
        });

        return renderedToolElement ? (
          <div key={toolCall.id}>{renderedToolElement}</div>
        ) : null;
      })}
    </div>
  );
}

function isToolMessageForCall(
  message: HeadlessMessage,
  toolCallId: string,
): message is ToolMessage {
  return (
    message.role === "tool" &&
    "toolCallId" in message &&
    message.toolCallId === toolCallId
  );
}

function getMessageText(message: HeadlessMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!content) return "";
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : isRecord(part) && typeof part.text === "string"
            ? part.text
            : "",
      )
      .join("");
  }
  if (isRecord(content) && typeof content.text === "string") {
    return content.text;
  }
  return "";
}

type WeatherResult = {
  city?: string;
  location?: string;
  temperature?: number;
  conditions?: string;
  humidity?: number;
  wind_speed?: number;
  windSpeed?: number;
  feels_like?: number;
  feelsLike?: number;
};

function parseWeatherResult(result: unknown): WeatherResult {
  if (!result) return {};

  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      return isRecord(parsed) ? (parsed as WeatherResult) : {};
    } catch {
      return {};
    }
  }

  return isRecord(result) ? (result as WeatherResult) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getGradient(conditions: string): string {
  const c = conditions.toLowerCase();
  if (c.includes("clear") || c.includes("sunny"))
    return "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)";
  if (c.includes("rain") || c.includes("storm"))
    return "linear-gradient(135deg, #475569 0%, #1e293b 100%)";
  if (c.includes("cloud") || c.includes("overcast"))
    return "linear-gradient(135deg, #64748b 0%, #334155 100%)";
  if (c.includes("snow"))
    return "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)";
  return "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)";
}

function getIcon(conditions: string): string {
  const c = conditions.toLowerCase();
  if (c.includes("clear") || c.includes("sunny")) return "☀️";
  if (c.includes("rain") || c.includes("drizzle")) return "🌧️";
  if (c.includes("snow")) return "❄️";
  if (c.includes("thunderstorm")) return "⛈️";
  if (c.includes("cloud") || c.includes("overcast")) return "☁️";
  if (c.includes("fog")) return "🌫️";
  return "🌤️";
}

function WeatherCard({
  location,
  temperature,
  conditions,
  humidity,
  windSpeed,
  feelsLike,
}: {
  location: string;
  temperature: number;
  conditions: string;
  humidity: number;
  windSpeed: number;
  feelsLike: number;
}) {
  const tempF = ((temperature * 9) / 5 + 32).toFixed(0);

  return (
    <div
      data-testid="weather-card"
      className="overflow-hidden rounded-2xl shadow-xl"
      style={{ background: getGradient(conditions), width: "340px" }}
    >
      <div className="px-6 pb-4 pt-5">
        <div className="flex items-start justify-between">
          <div>
            <h3
              data-testid="weather-city"
              className="text-lg font-bold capitalize tracking-normal text-white"
            >
              {location}
            </h3>
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-white/60">
              Current Weather
            </p>
          </div>
          <span className="text-5xl leading-none">{getIcon(conditions)}</span>
        </div>

        <div className="mt-5 flex items-baseline gap-2">
          <span className="text-5xl font-extralight tracking-normal text-white">
            {temperature}°
          </span>
          <span className="text-xs text-white/50">{tempF}°F</span>
        </div>

        <p className="mt-1 text-sm font-medium capitalize text-white/80">
          {conditions}
        </p>
      </div>

      <div
        className="grid grid-cols-3 px-6 py-3 text-center"
        style={{ background: "rgba(0,0,0,0.15)" }}
      >
        <WeatherStat label="Humidity" value={`${humidity}%`} />
        <WeatherStat label="Wind" value={`${windSpeed} mph`} bordered />
        <WeatherStat label="Feels Like" value={`${feelsLike}°`} />
      </div>
    </div>
  );
}

function WeatherStat({
  label,
  value,
  bordered = false,
}: {
  label: string;
  value: string;
  bordered?: boolean;
}) {
  return (
    <div className={bordered ? "border-x border-white/10" : undefined}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-white/50">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

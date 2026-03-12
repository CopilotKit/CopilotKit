"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import {
  useAgent,
  useCopilotKit,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { WidgetInput } from "./widget-input";
import { useWidgets } from "@/contexts/widgets-context";
import type { Widget } from "@/types/widget";
import type { ComponentInstance } from "@copilotkitnext/a2ui-renderer";
import { success } from "zod/v4";
import { parseRobustJSON } from "@/lib/json-parser";

const DEFAULT_COMPONENTS: ComponentInstance[] = [
  {
    id: "root",
    component: {
      Card: {
        child: "content",
      },
    },
  },
  {
    id: "content",
    component: {
      Text: {
        text: { path: "/title" },
      },
    },
  },
];

const DEFAULT_DATA = { title: "Hello World" };

export function CreateWidget() {
  const router = useRouter();
  const { addWidget } = useWidgets();
  const { agent } = useAgent();
  const { copilotkit } = useCopilotKit();

  const [inputValue, setInputValue] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [dotCount, setDotCount] = useState(1);

  // Refs to capture tool results
  const generatedName = useRef<string | null>(null);
  const generatedComponents = useRef<ComponentInstance[] | null>(null);
  const generatedData = useRef<Record<string, unknown> | null>(null);

  // Frontend tool for creating new widgets - captures AI output
  useFrontendTool({
    name: "editWidget",
    description:
      "Create a new widget with the specified name, data, and components.",
    parameters: z.object({
      name: z
        .string()
        .describe(
          'A short descriptive name for the widget (e.g. "User Profile Card", "Weather Widget").',
        ),
      data: z.string().describe("The data object for the widget in JSON."),
      components: z
        .string()
        .describe("The components array for the widget in JSON."),
    }),
    render: ({ args, status }) => {
      const isGenerating = status !== "complete";

      return (
        <div className="w-full">
          <button
            type="button"
            className={`
              w-full flex items-center justify-between gap-3 px-6 py-4 rounded-full text-sm font-medium
              transition-all shadow-sm border text-foreground
              ${
                isGenerating
                  ? "bg-secondary/50 border-border cursor-wait"
                  : "bg-primary text-primary-foreground border-primary hover:bg-primary/90 cursor-pointer hover:shadow-md"
              }
            `}
            disabled={isGenerating}
          >
            <span className="flex items-center gap-2 text-foreground">
              {isGenerating && (
                <svg
                  className="animate-spin size-5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              )}
              <span>
                {isGenerating ? (
                  <>
                    Creating:{" "}
                    <span className="font-semibold">
                      {args?.name || "Widget"}
                    </span>
                  </>
                ) : (
                  <>
                    Created:{" "}
                    <span className="font-semibold">
                      {args?.name || "Widget"}
                    </span>
                  </>
                )}
              </span>
            </span>
            {!isGenerating && (
              <svg
                className="size-5 text-foreground"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </button>
        </div>
      );
    },
    handler: async ({ name, data, components }) => {
      try {
        generatedName.current = name;
        generatedData.current = parseRobustJSON(data) as Record<
          string,
          unknown
        >;
        generatedComponents.current = parseRobustJSON(
          components,
        ) as ComponentInstance[];
      } catch (error) {
        return {
          success: false,
          error: `Error parsing JSON: ${error}`,
        };
      }
      return { success: true };
    },
  });

  const handleCreate = async () => {
    if (!inputValue.trim() || isGenerating) return;

    setIsGenerating(true);

    // Reset refs
    generatedName.current = null;
    generatedComponents.current = null;
    generatedData.current = null;

    const widgetId = uuidv4();

    try {
      // Reset agent for fresh conversation
      agent.setMessages([]);
      agent.threadId = widgetId;

      // Add user message
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: inputValue,
      });

      // Run agent (will call editWidget tool)
      await copilotkit.runAgent({ agent });

      // Create widget with generated content (or defaults if tool wasn't called)
      const newWidget: Widget = {
        id: widgetId,
        name: generatedName.current ?? "Untitled widget",
        createdAt: new Date(),
        updatedAt: new Date(),
        root: "root",
        components: generatedComponents.current ?? DEFAULT_COMPONENTS,
        dataStates: [
          {
            name: "default",
            data: generatedData.current ?? DEFAULT_DATA,
          },
        ],
      };

      await addWidget(newWidget);
      router.push(`/widget/${widgetId}`);
    } catch (error) {
      console.error("Failed to generate widget:", error);
      setIsGenerating(false);
    }
  };

  // Animate dots when generating
  useEffect(() => {
    if (!isGenerating) {
      setDotCount(1);
      return;
    }

    const interval = setInterval(() => {
      setDotCount((prev) => (prev >= 3 ? 1 : prev + 1));
    }, 500);

    return () => clearInterval(interval);
  }, [isGenerating]);

  const handleStartBlank = async () => {
    const id = uuidv4();
    const newWidget: Widget = {
      id,
      name: "Untitled widget",
      createdAt: new Date(),
      updatedAt: new Date(),
      root: "root",
      components: DEFAULT_COMPONENTS,
      dataStates: [
        {
          name: "default",
          data: DEFAULT_DATA,
        },
      ],
    };
    await addWidget(newWidget);
    router.push(`/widget/${id}`);
  };

  return (
    <div className="flex w-full flex-col items-center gap-4 px-4">
      <h1 className="text-4xl font-extralight tracking-tight">
        What would you like to build?
      </h1>
      <WidgetInput
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleCreate}
        disabled={isGenerating}
      />
      <span className="text-xs text-muted-foreground">
        Powered by 🪁 CopilotKit
      </span>
      {isGenerating ? (
        <span className="mt-4 text-lg text-muted-foreground">
          Generating widget
          <span className="inline-block w-[0.75rem] text-left">
            {".".repeat(dotCount)}
          </span>
        </span>
      ) : (
        <button
          onClick={handleStartBlank}
          className="mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          or <span className="underline">Start Blank</span>
        </button>
      )}
    </div>
  );
}

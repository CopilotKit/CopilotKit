"use client";

// @region[bar-chart-renderer]
import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useComponent,
  useFrontendTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { BarChart, barChartPropsSchema } from "./bar-chart";
import { PieChart, pieChartPropsSchema } from "./pie-chart";

export default function ToolBasedGenUiDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="gen-ui-tool-based">
      <Chat />
    </CopilotKit>
  );
}

interface Haiku {
  japanese: string[];
  english: string[];
  image_name: string | null;
  gradient: string;
}

function HaikuCard({ haiku }: { haiku: Partial<Haiku> }) {
  return (
    <div
      data-testid="haiku-card"
      style={{ background: haiku.gradient }}
      className="relative bg-gradient-to-br from-slate-50 to-blue-50 rounded-2xl my-6 p-8 max-w-2xl border border-slate-200 overflow-hidden"
    >
      <div className="relative z-10 flex flex-col items-center space-y-6">
        {haiku.japanese?.map((line, index) => (
          <div
            key={index}
            className="flex flex-col items-center text-center space-y-2"
          >
            <p
              data-testid="haiku-japanese-line"
              className="font-serif font-bold text-4xl md:text-5xl bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent tracking-wide"
            >
              {line}
            </p>
            <p
              data-testid="haiku-english-line"
              className="font-light text-base md:text-lg text-slate-600 italic max-w-md"
            >
              {haiku.english?.[index]}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Chat() {
  useComponent({
    name: "render_bar_chart",
    description: "Display a bar chart with labeled numeric values.",
    parameters: barChartPropsSchema,
    render: BarChart,
  });
  // @endregion[bar-chart-renderer]

  // @region[pie-chart-renderer]
  useComponent({
    name: "render_pie_chart",
    description: "Display a pie chart with labeled numeric values.",
    parameters: pieChartPropsSchema,
    render: PieChart,
  });
  // @endregion[pie-chart-renderer]

  // @region[haiku-renderer]
  useFrontendTool({
    name: "generate_haiku",
    parameters: z.object({
      japanese: z.array(z.string()).describe("3 lines of haiku in Japanese"),
      english: z
        .array(z.string())
        .describe("3 lines of haiku translated to English"),
      image_name: z
        .string()
        .describe("One relevant image name from the valid set"),
      gradient: z.string().describe("CSS Gradient color for the background"),
    }),
    followUp: false,
    handler: async ({
      japanese,
      english,
      image_name,
      gradient,
    }: {
      japanese: string[];
      english: string[];
      image_name: string;
      gradient: string;
    }) => {
      return "Haiku generated!";
    },
    render: ({ args }: { args: Partial<Haiku> }) => {
      if (!args.japanese) return <></>;
      return <HaikuCard haiku={args as Haiku} />;
    },
  });
  // @endregion[haiku-renderer]

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Sales bar chart",
        message: "Show me a bar chart of quarterly sales for Q1, Q2, Q3, Q4.",
      },
      {
        title: "Traffic pie chart",
        message: "Show me a pie chart of website traffic by source.",
      },
      {
        title: "Nature haiku",
        message: "Write me a haiku about nature",
      },
    ],
    available: "always",
  });

  return (
    <div className="flex justify-center items-center h-screen w-full">
      <div className="h-full w-full max-w-4xl">
        <CopilotChat
          agentId="gen-ui-tool-based"
          className="h-full rounded-2xl"
        />
      </div>
    </div>
  );
}

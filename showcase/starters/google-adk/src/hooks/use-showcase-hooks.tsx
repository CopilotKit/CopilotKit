import { z } from "zod";

import {
  useComponent,
  useFrontendTool,
  useHumanInTheLoop,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";

import { PieChart, PieChartProps } from "../components/charts/pie-chart";
import { BarChart, BarChartProps } from "../components/charts/bar-chart";
import { MeetingTimePicker } from "../components/meeting-time-picker";
import { ToolReasoning } from "../components/tool-reasoning";

export const useShowcaseHooks = () => {
  // Human-in-the-Loop (frontend tool requiring user decision)
  useHumanInTheLoop({
    name: "scheduleTime",
    description: "Use human-in-the-loop to schedule a meeting with the user.",
    parameters: z.object({
      reasonForScheduling: z
        .string()
        .describe("Reason for scheduling, very brief - 5 words."),
      meetingDuration: z
        .number()
        .describe("Duration of the meeting in minutes"),
    }),
    render: ({ respond, status, args }) => {
      return <MeetingTimePicker status={status} respond={respond} {...args} />;
    },
  });

  // Controlled Generative UI (frontend-defined chart components)
  useComponent({
    name: "pieChart",
    description: "Controlled Generative UI that displays data as a pie chart.",
    parameters: PieChartProps,
    render: PieChart,
  });

  useComponent({
    name: "barChart",
    description: "Controlled Generative UI that displays data as a bar chart.",
    parameters: BarChartProps,
    render: BarChart,
  });

  // Default Tool Rendering (backend tool UI)
  const ignoredTools = [
    "render_a2ui", // Rendered by A2UI streaming, not as a tool card
    "generate_a2ui", // Rendered by A2UI, not as a tool card
    "log_a2ui_event", // Internal A2UI event tracker
  ];
  useDefaultRenderTool({
    render: ({ name, status, parameters }) => {
      if (ignoredTools.includes(name)) return <></>;
      return <ToolReasoning name={name} status={status} args={parameters} />;
    },
  });

  // Frontend Tools (direct frontend state manipulation)
  useFrontendTool(
    {
      name: "toggleTheme",
      description: "Frontend tool for toggling the theme of the app.",
      parameters: z.object({}),
      handler: async () => {
        const isDark = document.documentElement.classList.contains("dark");
        if (isDark) {
          document.documentElement.classList.remove("dark");
          document.documentElement.classList.add("light");
        } else {
          document.documentElement.classList.remove("light");
          document.documentElement.classList.add("dark");
        }
      },
    },
    [],
  );
};

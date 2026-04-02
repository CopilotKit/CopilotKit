import { z } from "zod";
import {
  useComponent,
  useFrontendTool,
  useHumanInTheLoop,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";
import {
  PieChart,
  PieChartPropsSchema,
} from "@/components/generative-ui/PieChart";
import {
  BarChart,
  BarChartPropsSchema,
} from "@/components/generative-ui/BarChart";
import { ToolReasoning } from "@/components/generative-ui/ToolReasoning";
import { MeetingTimePicker } from "@/components/generative-ui/MeetingTimePicker";
import { useTheme } from "@/hooks/useTheme";

export const useCopilotExamples = () => {
  const { theme, setTheme } = useTheme();

  // Frontend tool: toggle light/dark mode
  useFrontendTool(
    {
      name: "toggleTheme",
      description: "Frontend tool for toggling the theme of the app.",
      parameters: z.object({}),
      handler: async () => {
        setTheme(theme === "dark" ? "light" : "dark");
      },
    },
    [theme, setTheme],
  );

  // Controlled Generative UI: pie chart
  useComponent({
    name: "pieChart",
    description: "Controlled Generative UI that displays data as a pie chart.",
    parameters: PieChartPropsSchema,
    render: PieChart,
  });

  // Controlled Generative UI: bar chart
  useComponent({
    name: "barChart",
    description: "Controlled Generative UI that displays data as a bar chart.",
    parameters: BarChartPropsSchema,
    render: BarChart,
  });

  // Default renderer for all backend tool calls
  useDefaultRenderTool({
    render: ({ name, status, parameters }) => (
      <ToolReasoning name={name} status={status} args={parameters} />
    ),
  });

  // Human-in-the-loop: meeting scheduler
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
    render: ({ respond, status, args }) => (
      <MeetingTimePicker status={status} respond={respond} {...args} />
    ),
  });
};

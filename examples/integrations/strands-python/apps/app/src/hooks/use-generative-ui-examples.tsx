import { z } from "zod";
import { useTheme } from "@/hooks/use-theme";

// CopilotKit imports
import {
  useComponent,
  useFrontendTool,
  useHumanInTheLoop,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";

// Generative UI imports
import {
  PieChart,
  PieChartProps,
} from "@/components/generative-ui/charts/pie-chart";
import {
  BarChart,
  BarChartProps,
} from "@/components/generative-ui/charts/bar-chart";
import { MeetingTimePicker } from "@/components/generative-ui/meeting-time-picker";
import { ToolReasoning } from "@/components/tool-rendering";

export const useGenerativeUIExamples = () => {
  const { theme, setTheme } = useTheme();

  // ----------------------------------------------------------
  // 1. Controlled Generative UI (frontend-defined components)
  //    https://docs.copilotkit.ai/langgraph/generative-ui/frontend-tools
  // ----------------------------------------------------------
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

  // ----------------------------------------------------------
  // 2. Human-in-the-Loop (frontend tool requiring user decision)
  //    https://docs.copilotkit.ai/langgraph/human-in-the-loop/frontend-tool-based
  // ----------------------------------------------------------
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

  // ----------------------------------------------------------
  // 3. Default Tool Rendering (backend tool UI)
  //    https://docs.copilotkit.ai/langgraph/generative-ui/backend-tools
  // ----------------------------------------------------------
  const ignoredTools = [
    // generate_form is rendered by A2UI's declarative surface system, not as a tool call
    "generate_form",
    // log_a2ui_event is an internal A2UI event tracker, not meaningful to display to users
    "log_a2ui_event",
  ];
  useDefaultRenderTool({
    render: ({ name, status, parameters }) => {
      if (ignoredTools.includes(name)) return <></>;
      return <ToolReasoning name={name} status={status} args={parameters} />;
    },
  });

  // ----------------------------------------------------------
  // 4. Frontend Tools (direct frontend state manipulation)
  //    https://docs.copilotkit.ai/langgraph/frontend-actions
  // ----------------------------------------------------------
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
};

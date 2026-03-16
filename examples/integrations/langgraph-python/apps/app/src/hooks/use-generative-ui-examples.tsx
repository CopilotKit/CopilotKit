import { z } from "zod";
import { useTheme } from "@/hooks/use-theme";

// CopilotKit imports
import {
  useComponent,
  useFrontendTool,
  useHumanInTheLoop,
  useDefaultRenderTool,
  useA2UIActionHandler,
} from "@copilotkit/react-core/v2";

// A2UI schemas
import bookedSchema from "@/a2ui/booked_schema.json";

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
import { A2UIProgress } from "@/components/generative-ui/a2ui-progress";

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
    "search_flights",            // Rendered by A2UI fixed-schema surfaces, not as a tool card
    "search_flights_streaming",  // Rendered by A2UI streaming surfaces, not as a tool card
    "generate_a2ui",             // Rendered by A2UI dynamic surfaces, not as a tool card
    "log_a2ui_event",            // Internal A2UI event tracker injected by middleware
  ];
  useDefaultRenderTool({
    render: ({ name, status, parameters }) => {
      if (ignoredTools.includes(name)) return <></>;

      // Custom progress visualization for dynamic A2UI generation
      if (name === "render_a2ui") {
        if (status === "complete") return <></>;
        return <A2UIProgress parameters={parameters} />;
      }

      return <ToolReasoning name={name} status={status} args={parameters} />;
    },
  });

  // ----------------------------------------------------------
  // 3b. A2UI Optimistic Action Handler (Advanced)
  //     Applies instant UI updates when A2UI buttons are clicked.
  //     Uses pre-declared ops from the agent when available,
  //     otherwise builds custom confirmation ops on the frontend.
  // ----------------------------------------------------------
  useA2UIActionHandler((action, declaredOps) => {
    if (action.name === "book_flight") {
      // If the agent declared ops for this action, use them
      if (declaredOps) return declaredOps;

      // Otherwise, build our own
      const { surfaceId } = action;
      const fn = action.context?.flightNumber ?? "flight";
      const orig = action.context?.origin ?? "";
      const dest = action.context?.destination ?? "";
      return [
        { surfaceUpdate: { surfaceId, components: bookedSchema } },
        {
          dataModelUpdate: {
            surfaceId,
            contents: [
              { key: "title", valueString: "Booked!" },
              { key: "detail", valueString: `${fn}: ${orig} → ${dest}` },
            ],
          },
        },
        { beginRendering: { surfaceId, root: "root" } },
      ];
    }
    return null;
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

/**
 * Beautiful-chat generative-UI tool registrations.
 *
 * Ported from the langgraph-python flagship
 * (src/app/demos/beautiful-chat/hooks/use-generative-ui-examples.tsx).
 * Registers the three controlled-gen-UI surfaces the dashboard probes
 * exercise on this cell:
 *
 *   - `pieChart`  → PieChart   (useComponent)
 *   - `barChart`  → BarChart   (useComponent)
 *   - `scheduleTime` → MeetingTimePicker (useHumanInTheLoop)
 *
 * plus the `toggleTheme` frontend tool (already green — kept intact).
 *
 * The CopilotKit runtime forwards these frontend tool definitions to the
 * agent (see the Python backend's `_build_frontend_tools`), so the LLM —
 * or the aimock fixture — can call them by name and the matching `render`
 * callback paints the component inline.
 */
import { z } from "zod";
import { useTheme } from "./use-theme";

import {
  useComponent,
  useFrontendTool,
  useHumanInTheLoop,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";

import {
  PieChart,
  PieChartProps,
} from "../components/generative-ui/charts/pie-chart";
import {
  BarChart,
  BarChartProps,
} from "../components/generative-ui/charts/bar-chart";
import { MeetingTimePicker } from "../components/generative-ui/meeting-time-picker";
import { ToolReasoning } from "../components/tool-rendering";

export const useGenerativeUIExamples = () => {
  const { setTheme } = useTheme();

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

  // Default Tool Rendering (backend tool UI) — render any other backend
  // tool call as a compact reasoning card.
  useDefaultRenderTool({
    render: ({ name, status, parameters }) => {
      return <ToolReasoning name={name} status={status} args={parameters} />;
    },
  });

  // Frontend Tools (direct frontend state manipulation).
  // No deps array — the handler reads `document` directly and calls a
  // stable setter. Including [theme, setTheme] in deps re-registers the
  // hook on every theme flip, which can race an in-flight tool result.
  useFrontendTool({
    name: "toggleTheme",
    description: "Frontend tool for toggling the theme of the app.",
    parameters: z.object({}),
    handler: async () => {
      const isDark = document.documentElement.classList.contains("dark");
      setTheme(isDark ? "light" : "dark");
    },
  });
};

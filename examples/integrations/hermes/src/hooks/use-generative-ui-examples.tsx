import { z } from "zod";
import { useTheme } from "@/hooks/use-theme";

import {
  useFrontendTool,
  useHumanInTheLoop,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";

import { MeetingTimePicker } from "@/components/generative-ui/meeting-time-picker";
import { ToolReasoning } from "@/components/tool-rendering";

// Frontend tools/UI that work with any `hermes agui` agent (the AG-UI adapter
// forwards client-declared tools to the model). The Calculator demo needs no
// registration here — it uses the runtime's open-generative-UI feature
// (`openGenerativeUI` in the API route + on the provider).
export const useGenerativeUIExamples = () => {
  const { theme, setTheme } = useTheme();

  // Human-in-the-Loop (frontend tool requiring a user decision)
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

  // Default rendering for any tool call (e.g. the toggleTheme chip).
  useDefaultRenderTool({
    render: ({ name, status, parameters }) => (
      <ToolReasoning name={name} status={status} args={parameters} />
    ),
  });

  // Frontend tool (direct frontend state manipulation)
  useFrontendTool(
    {
      name: "toggleTheme",
      description: "Frontend tool for toggling the theme of the app.",
      parameters: z.object({}),
      handler: async () => {
        const isDark = document.documentElement.classList.contains("dark");
        setTheme(isDark ? "light" : "dark");
      },
    },
    [theme, setTheme],
  );
};

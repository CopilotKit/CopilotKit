import { z } from "zod";
import { useTheme } from "@/hooks/use-theme";

import {
  useAgent,
  useComponent,
  useCopilotChatConfiguration,
  useFrontendTool,
  useHumanInTheLoop,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";
import type { Issue } from "@/components/pm-board/types";

import {
  PieChart,
  PieChartProps,
} from "@/components/generative-ui/charts/pie-chart";
import {
  BarChart,
  BarChartProps,
} from "@/components/generative-ui/charts/bar-chart";
import { MeetingTimePicker } from "@/components/generative-ui/meeting-time-picker";
import {
  IssueCardChip,
  IssueCardProps,
} from "@/components/generative-ui/issue-card";
import {
  IssueList,
  IssueListProps,
} from "@/components/generative-ui/issue-list";
import {
  IssueTable,
  IssueTableProps,
} from "@/components/generative-ui/issue-table";
import {
  AgentProgress,
  AgentProgressProps,
} from "@/components/generative-ui/agent-progress";
import { ApprovalCard } from "@/components/generative-ui/approval-card";
import { ToolReasoning } from "@/components/tool-rendering";

export const useGenerativeUIExamples = () => {
  const { theme, setTheme } = useTheme();
  // Bind to the same per-thread agent clone the chat is using. Without
  // agentId from config, useAgent() would resolve to a different default
  // clone and applyPlanningChanges / updateDashboard would mutate state the
  // board / dashboard never sees.
  const config = useCopilotChatConfiguration();
  const { agent } = useAgent({ agentId: config?.agentId });

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

  // HITL for single-issue mutations. Pairs with the agent's
  // propose_issue_change tool — agent calls that, frontend renders the
  // approval card here, user accepts / edits / rejects.
  useHumanInTheLoop({
    name: "proposeIssueMutation",
    description:
      "Ask the user to approve a mutation to a single issue. Use for any single-issue change (status move, assignee, priority).",
    parameters: z.object({
      issueId: z.string().describe("The issue id, e.g. ISS-101"),
      changes: z
        .object({
          status: z
            .enum(["Backlog", "Todo", "In Progress", "In Review", "Done"])
            .optional(),
          priority: z.enum(["Urgent", "High", "Med", "Low"]).optional(),
          assignee: z.string().optional(),
          title: z.string().optional(),
          description: z.string().optional(),
        })
        .describe("The partial issue changes to apply on accept."),
    }),
    render: ({ respond, status, args }) => {
      return (
        <ApprovalCard
          status={status}
          respond={respond}
          issueId={args.issueId}
          changes={args.changes ?? {}}
        />
      );
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

  useComponent({
    name: "issueCard",
    description:
      "Render a single project issue as an inline glass card with a 'View on board' button.",
    parameters: IssueCardProps,
    render: IssueCardChip,
  });

  useComponent({
    name: "issueList",
    description:
      "Call this to surface a list of issues inline in chat as glass cards. Use it whenever the user asks to 'show', 'list', or 'see' specific issues. Pass issueIds with the ids you want to surface (e.g. all urgent issues, all unassigned issues, the ones you just edited) — the frontend looks them up in agent state. Call get_issues first if you don't already have the ids.",
    parameters: IssueListProps,
    render: IssueList,
  });

  useComponent({
    name: "issueTable",
    description:
      "Call this to surface a list of issues inline in chat as a compact table (ID / Title / Status / Priority / Assignee / Due). Prefer this over issueList when the user asks to 'list', 'tabulate', or see a quick at-a-glance view (e.g. 'show me all urgent issues'). Pass issueIds with the ids you want to surface — the frontend looks them up in agent state.",
    parameters: IssueTableProps,
    render: IssueTable,
  });

  // Sprint-planning progress narration. Each call renders a single animated
  // step card (spinner -> green check) so the chain reads as "reading image ->
  // transcribing -> planning tickets -> writing tickets" before the actual
  // manage_issues mutation lands. Purely visual; the agent (or fixture) emits
  // one tool call per step.
  useComponent({
    name: "agentProgress",
    description:
      "Narrate a single step of a longer agent workflow as an animated progress card. Call once per step in sequence. Used by the sprint-planning demo to show 'reading_image', 'transcribing', 'planning_tickets', 'writing_tickets'. After the four narration steps, call once more with step='complete' to fold the prior cards into a single 'Analysis and breakdown complete' summary.",
    parameters: AgentProgressProps,
    render: AgentProgress,
  });

  // Default Tool Rendering (backend tool UI)
  const ignoredTools = ["render_a2ui", "generate_a2ui", "log_a2ui_event"];
  // Friendly labels for tool calls that get rendered with the default
  // ToolReasoning row. Without a mapping, raw identifiers like
  // `applyPlanningChanges` leak into the user-facing chat. Keep the entries
  // here aligned with the agent's tool surface in
  // apps/agent/src + frontend tool registrations below.
  const toolDisplayNames: Record<string, string> = {
    applyPlanningChanges: "writing the tickets",
    enableAppMode: "open sprint board",
    // Dashboard Designer hardcoded-chip narration tools (emitted by the
    // Build-the-dashboard / Sarah's-workload chip handlers in App.tsx so
    // the user sees the agent "do the work" before the pane renders).
    getData: "Get Data",
    buildDashboard: "Build Dashboard",
  };
  useDefaultRenderTool({
    render: ({ name, status, parameters }) => {
      if (ignoredTools.includes(name)) return <></>;
      return (
        <ToolReasoning
          name={name}
          status={status}
          args={parameters}
          displayName={toolDisplayNames[name]}
        />
      );
    },
  });

  // Frontend Tools (direct frontend state manipulation)
  useFrontendTool(
    {
      name: "toggleTheme",
      description:
        "Frontend tool for toggling between the two CopilotKit glass-density variants (light / frosted).",
      parameters: z.object({}),
      handler: async () => {
        const isDark = document.documentElement.classList.contains("dark");
        setTheme(isDark ? "light" : "dark");
      },
    },
    [theme, setTheme],
  );

  // applyPlanningChanges: silent partial-update tool used at the end of the
  // sprint-planning narration. The fixture emits one of these with the diff
  // derived from the handwritten notes (e.g. ISS-101 -> Done, ISS-113 ->
  // Todo); the handler reads current state, merges the partial changes by id,
  // and pushes the new list back via agent.setState. No render — the visible
  // effect is the board re-rendering with the moved cards. We don't go
  // through manage_issues here because (a) it would force the fixture to
  // carry the entire 20-issue list and (b) we want this to be a frontend
  // mutation so the demo plays even if the agent itself is mocked out.
  useFrontendTool(
    {
      name: "applyPlanningChanges",
      description:
        "Apply a list of partial issue updates to the board (status / priority / assignee per id). The frontend merges the diff into agent state. Use after narrating the sprint-planning workflow with agentProgress.",
      parameters: z.object({
        changes: z
          .array(
            z.object({
              id: z.string(),
              status: z
                .enum(["Backlog", "Todo", "In Progress", "In Review", "Done"])
                .optional(),
              priority: z.enum(["Urgent", "High", "Med", "Low"]).optional(),
              assignee: z.string().optional(),
            }),
          )
          .describe("Partial updates keyed by issue id."),
      }),
      handler: async ({ changes }) => {
        const current = (agent.state?.issues as Issue[] | undefined) ?? [];
        const byId = new Map(
          (changes as Array<Partial<Issue> & { id: string }>).map((c) => [
            c.id,
            c,
          ]),
        );
        const updated = current.map((issue) => {
          const change = byId.get(issue.id);
          return change ? { ...issue, ...change } : issue;
        });
        agent.setState({ issues: updated });
      },
    },
    [agent],
  );

  // Dashboard Designer (ADK) — agent-driven filter on the stats dashboard.
  // The agent calls this with a partial filter + a one-line "focus" summary
  // shown in the dashboard header. Each call REPLACES the previous filter
  // wholesale, so the agent should re-send any filters it wants to keep.
  // Pass an empty filter ({}) to reset. The handler writes to
  // agent.state.dashboard; the <Dashboard> component re-derives every
  // aggregate from the filtered set.
  useFrontendTool(
    {
      name: "updateDashboard",
      description:
        "Update the Dashboard Designer's filter and focus copy. Call this when the user asks to break down, filter, or focus the dashboard on a slice of the work (e.g. 'show Sarah's tickets', 'urgent only', 'reset'). The filter REPLACES the previous filter; pass an empty filter to clear. The focus string is shown above the stats and should be one short sentence in the assistant's voice ('Showing Sarah's high-priority work.').",
      parameters: z.object({
        filter: z
          .object({
            // NB: no .nullable() on any field below — Google ADK's Schema
            // validator rejects JSON-Schema's array-form type (`["string",
            // "null"]`) and only accepts a single type. Since an empty filter
            // ({}) already means "clear", null was redundant anyway.
            assignee: z
              .string()
              .optional()
              .describe(
                "Assignee name to filter to, e.g. 'Sarah'. Omit to clear.",
              ),
            priority: z.enum(["Urgent", "High", "Med", "Low"]).optional(),
            status: z
              .enum(["Backlog", "Todo", "In Progress", "In Review", "Done"])
              .optional(),
            labels: z
              .array(z.string())
              .optional()
              .describe(
                "Optional label filter; an issue must have every listed label.",
              ),
          })
          .optional()
          .describe(
            "Replacement filter for the dashboard. Empty object {} clears.",
          ),
        focus: z
          .string()
          .optional()
          .describe(
            "One-line summary shown in the dashboard header. Keep under ~80 chars.",
          ),
      }),
      handler: async (args) => {
        // Strip nulls so JSON serialization stays compact and the empty-filter
        // case ({}) reliably triggers the "no filter" path in <Dashboard>.
        const filter: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(args.filter ?? {})) {
          if (v !== null && v !== undefined) filter[k] = v;
        }
        // Spread the current state so we don't clobber `issues` (the kanban
        // board mirror) when we only mean to update the dashboard slice.
        const current = (agent.state as Record<string, unknown>) ?? {};
        agent.setState({
          ...current,
          dashboard: {
            filter,
            focus: args.focus,
          },
        });
      },
    },
    [agent],
  );
};

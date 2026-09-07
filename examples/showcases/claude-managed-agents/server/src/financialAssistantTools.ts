/**
 * Tools the financial assistant executes on this server. The adapter streams
 * each call to the browser as AG-UI TOOL_CALL events, CopilotKit renders the
 * matching React component, and the handler's acknowledgement goes back to
 * the managed session so the turn can continue.
 */
import type { BackendCustomTool } from "@ag-ui/claude-managed-agents";

const rendered = (name: string) => () =>
  `Rendered "${name}" to the user as an interactive visual.`;

export const financialAssistantTools: BackendCustomTool[] = [
  {
    name: "show_growth_projection",
    description:
      "Render an interactive compound-growth chart in the chat: projected value over the " +
      "years versus total contributed, with sliders for monthly contribution and return rate. " +
      'Use whenever you discuss investing, retirement pace, or "what will this grow to".',
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: 'Short chart title, e.g. "Roth IRA at 7%"',
        },
        initialAmount: {
          type: "number",
          minimum: 0,
          description: "Starting balance in dollars",
        },
        monthlyContribution: {
          type: "number",
          minimum: 0,
          description: "Monthly contribution in dollars",
        },
        annualReturnPercent: {
          type: "number",
          minimum: 0,
          maximum: 30,
          description: "Assumed annual return, e.g. 7",
        },
        years: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Projection horizon in years",
        },
      },
      required: [
        "title",
        "initialAmount",
        "monthlyContribution",
        "annualReturnPercent",
        "years",
      ],
    },
    handler: rendered("show_growth_projection"),
  },
];

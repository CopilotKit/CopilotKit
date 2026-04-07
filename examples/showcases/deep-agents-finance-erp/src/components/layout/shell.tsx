"use client";

import {
  CopilotSidebar,
  CopilotSidebarView,
  useAgentContext,
  useAgent,
  useCopilotKit,
  useRenderTool,
  ToolCallStatus,
} from "@copilotkit/react-core/v2";
import { ToolCard } from "@/components/chat/tool-card";
import { cn } from "@/lib/utils";
import { useRenderChatVisual } from "@/hooks/use-render-chat-visual";
import { useNavigateAndFilter } from "@/hooks/use-navigate-and-filter";
import { useRequestApproval } from "@/hooks/use-request-approval";
import { useUpdateDashboard } from "@/hooks/use-update-dashboard";
import { useManageDashboard } from "@/hooks/use-manage-dashboard";
import { useSaveDashboard } from "@/hooks/use-save-dashboard";
import { useDashboard } from "@/context/dashboard-context";
import { Sidebar } from "./sidebar";
import { kpis } from "@/lib/data";

const demoSuggestions = [
  {
    title: "Cash Position",
    message:
      "What's our current cash position and how does it compare to our liabilities?",
  },
  {
    title: "Overdue Invoices",
    message: "Show me all overdue invoices",
  },
  {
    title: "Cash Flow Chart",
    message: "Give me a visual cash flow projection for the next 4 quarters",
  },
  {
    title: "Approve Payments",
    message: "Process payment for all overdue invoices",
  },
  {
    title: "Reorder Inventory",
    message:
      "Check inventory levels and reorder anything that needs restocking",
  },
  {
    title: "Cash Flow Dashboard",
    message:
      "Build me a dashboard focused on cash flow risk — show AR aging, overdue invoices at the top, and a quarterly cash projection",
  },
  {
    title: "Cost Control Dashboard",
    message:
      "I'm concerned about the Marketing overspend — set up a cost control view with budget tracking and spending trends",
  },
];

function FinanceSidebarWelcomeScreen({
  input,
  suggestionView,
  welcomeMessage,
  className,
  ...props
}: React.ComponentProps<typeof CopilotSidebarView.WelcomeScreen>) {
  const { agent } = useAgent({ agentId: "finance_erp_agent" });
  const { copilotkit } = useCopilotKit();

  const handlePromptClick = (message: string) => {
    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: message,
    });
    void copilotkit.runAgent({ agent });
  };

  return (
    <div
      className={cn("cpk:h-full cpk:flex cpk:flex-col", className)}
      {...props}
    >
      <div className="cpk:flex-1" />

      <div className="cpk:px-8 cpk:pb-4">
        <div className="cpk:mx-auto cpk:flex cpk:max-w-3xl cpk:flex-col cpk:items-center">
          <h2 className="cpk:mb-4 cpk:max-w-md cpk:text-center cpk:font-heading cpk:text-3xl cpk:font-medium cpk:leading-tight cpk:text-foreground">
            Ask about invoices, accounts, inventory, or HR.
          </h2>
          <div className="cpk:mb-4 cpk:flex cpk:max-w-md cpk:flex-wrap cpk:justify-center cpk:gap-3">
            {demoSuggestions.map((suggestion) => (
              <button
                key={suggestion.title}
                type="button"
                onClick={() => handlePromptClick(suggestion.message)}
                className="cpk:rounded-full cpk:border cpk:border-border cpk:bg-background cpk:px-4 cpk:py-2 cpk:text-sm cpk:font-medium cpk:text-foreground cpk:transition-colors hover:cpk:border-primary hover:cpk:bg-muted"
              >
                {suggestion.title}
              </button>
            ))}
          </div>
          <div className="cpk:w-full">{input}</div>
        </div>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return <ShellInner>{children}</ShellInner>;
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const { widgets, savedDashboards } = useDashboard();

  // Lightweight context — detailed data is available via backend research tools
  useAgentContext({
    description: "Key performance indicators for the company",
    value: kpis,
  });

  // Dashboard layout context — agent uses this to know current widget IDs and configuration
  useAgentContext({
    description:
      "Current dashboard layout — list of widgets with their IDs, types, column spans, order, and configuration. Use widget IDs when removing or updating widgets.",
    value: widgets,
  });

  // Saved dashboards context — agent can reference when loading saved layouts
  useAgentContext({
    description:
      "Saved dashboard configurations (templates and custom). Use load_dashboard to restore a saved one, save_dashboard to save the current layout. When the user asks for a standard view, suggest loading a template before building from scratch.",
    value: savedDashboards.map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      widgetCount: d.widgets.length,
      updatedAt: d.updatedAt,
    })),
  });

  // Wildcard tool renderer — catches do_research, do_projections, and any
  // other tools not handled by a named hook. Shows persistent ToolCards.
  useRenderTool(
    {
      name: "*",
      render: ({ name, status, args, result }) => {
        const mappedStatus =
          status === ToolCallStatus.Complete ? "complete" : "inProgress";
        return (
          <ToolCard
            name={name}
            status={mappedStatus}
            args={args ?? {}}
            result={result}
          />
        );
      },
    },
    [],
  );

  // Consolidated frontend tools (5 hooks replacing 14)
  useRenderChatVisual(); // Inline chart + cash position card
  useNavigateAndFilter(); // SPA navigation
  useRequestApproval(); // HITL: invoice payment + inventory reorder
  useUpdateDashboard(); // Add/update dashboard widgets (batch)
  useManageDashboard(); // Reset/remove/reorder dashboard
  useSaveDashboard(); // Save/load dashboard configurations

  return (
    <div className="flex h-screen bg-muted">
      <Sidebar />
      <main className="ml-[72px] flex-1 overflow-y-auto">{children}</main>
      <CopilotSidebar
        agentId="finance_erp_agent"
        defaultOpen={false}
        welcomeScreen={FinanceSidebarWelcomeScreen}
        instructions="You are the FinanceOS AI assistant. Always use do_research for data queries and do_projections for forecasts. Prefer rendering rich UI components (charts, cards, dashboard widgets) over plain text whenever possible."
        labels={{
          modalHeaderTitle: "FinanceOS AI",
          welcomeMessageText: "Ask about invoices, accounts, inventory, or HR.",
        }}
      />
    </div>
  );
}

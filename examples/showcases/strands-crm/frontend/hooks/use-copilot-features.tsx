"use client";
import { z } from "zod";
import {
  useRenderTool,
  useHumanInTheLoop,
  useFrontendTool,
  useConfigureSuggestions,
  useAgent,
} from "@copilotkit/react-core/v2";
import { useRouter } from "next/navigation";
import { EnrichmentCard } from "../components/EnrichmentCard";
import { DealBriefCard } from "../components/DealBriefCard";
import type { DealBrief } from "../components/DealBriefCard";
import type { EnrichmentResult } from "../lib/crm";
import { FollowupApprovalCard } from "../components/FollowupApprovalCard";
import { PipelinePriorities } from "../components/PipelinePriorities";
import type { PipelinePlan } from "../components/PipelinePriorities";
import { QuoteCard } from "../components/QuoteCard";
import type { QuoteResult } from "../components/QuoteCard";
import { WorkspaceHandoffCard } from "../components/WorkspaceHandoffCard";
import { RepStatsCard } from "../components/RepStatsCard";
import type { RepStatsResult } from "../components/RepStatsCard";
import type { Report } from "../lib/crm";
import { pageToRoute, PAGE_KEYS } from "../lib/navigation";

function parseResult<T>(result: unknown): T | undefined {
  if (!result) return undefined;
  if (typeof result === "string") {
    try {
      return JSON.parse(result) as T;
    } catch {
      return undefined;
    }
  }
  return result as T;
}

export function useCopilotFeatures({
  setSelectedDealId,
}: {
  setSelectedDealId: (id: string) => void;
}) {
  const router = useRouter();
  const { agent } = useAgent({ agentId: "strands_agent" });

  // Open/focus a deal in the board (same effect as the focus_deal tool).
  const openDeal = (dealId: string) => {
    router.push("/");
    setSelectedDealId(dealId);
  };
  // Send a templated user message to the copilot, then run the agent (card CTAs).
  const runAction = (message: string) => {
    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: message,
    });
    void agent.runAgent();
  };

  // Approve a hardware quote: persist it via the agent store, then switch the
  // workspace to the full quote page (which reads the persisted quote).
  const approveQuote = async (quote: QuoteResult) => {
    try {
      const res = await fetch("/api/crm/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quote),
      });
      if (!res.ok) throw new Error("approve failed");
      const saved = (await res.json()) as { id?: string };
      if (saved?.id) router.push(`/quotes/${saved.id}`);
    } catch {
      if (typeof console !== "undefined")
        console.error("Quote approval failed");
    }
  };

  // Generative UI: render the enrich_lead tool result as a card in chat.
  useRenderTool(
    {
      name: "enrich_lead",
      parameters: z.object({
        accountId: z.string().optional(),
        name: z.string().optional(),
      }),
      render: ({ result, status }) => (
        <EnrichmentCard
          result={parseResult<EnrichmentResult>(result)}
          status={status}
        />
      ),
    },
    [],
  );

  // Generative UI: render the brief_deal tool result as a card in chat.
  useRenderTool(
    {
      name: "brief_deal",
      parameters: z.object({ dealId: z.string() }),
      render: ({ result, status }) => (
        <DealBriefCard brief={parseResult<DealBrief>(result)} status={status} />
      ),
    },
    [],
  );

  // Generative UI: render the plan_pipeline tool result as a compact ranked priorities card.
  useRenderTool(
    {
      name: "plan_pipeline",
      parameters: z.object({ topN: z.number().optional() }),
      render: ({ result, status }) => (
        <PipelinePriorities
          plan={parseResult<PipelinePlan>(result)}
          status={status}
          onOpen={openDeal}
          onAction={runAction}
        />
      ),
    },
    // Deps are JSON-serialized by CopilotKit for change detection, so they must
    // stay primitive — never include the agent/router objects (circular RxJS
    // internals). openDeal/runAction close over stable refs, so [] is correct.
    [],
  );

  // Generative UI: recommend_products → hardware quote card.
  useRenderTool(
    {
      name: "recommend_products",
      parameters: z.object({
        accountId: z.string().optional(),
        name: z.string().optional(),
        seats: z.number().optional(),
        useCase: z.string().optional(),
      }),
      render: ({ result, status }) => (
        <QuoteCard
          result={parseResult<QuoteResult>(result)}
          status={status}
          onApprove={approveQuote}
        />
      ),
    },
    [],
  );

  // Generative UI: analyze_team → team performance stats card.
  useRenderTool(
    {
      name: "analyze_team",
      parameters: z.object({ period: z.string().optional() }),
      render: ({ status }) => (
        <WorkspaceHandoffCard
          title="Team performance ready"
          status={status}
          pendingLabel="Crunching the team numbers…"
          viewLabel="View team report"
          onShow={() => router.push("/reports/team")}
          onView={() => router.push("/reports/team")}
        />
      ),
    },
    [],
  );

  // Generative UI: rep_performance → individual rep stats card.
  useRenderTool(
    {
      name: "rep_performance",
      parameters: z.object({
        name: z.string().optional(),
        repId: z.string().optional(),
      }),
      render: ({ result, status }) => (
        <RepStatsCard
          result={parseResult<RepStatsResult>(result)}
          status={status}
        />
      ),
    },
    [],
  );

  // Generative UI: generate_weekly_report → report summary card; "View in Reports" routes to the page (the report also lands there via STATE_SNAPSHOT).
  useRenderTool(
    {
      name: "generate_weekly_report",
      parameters: z.object({
        periodStart: z.string().optional(),
        periodEnd: z.string().optional(),
      }),
      render: ({ result, status }) => {
        const report = parseResult<Report>(result);
        return (
          <WorkspaceHandoffCard
            title="Weekly report generated"
            subtitle={report?.title}
            status={status}
            pendingLabel="Generating the weekly report…"
            viewLabel="View report"
            onShow={() => router.push("/reports/weekly")}
            onView={() => router.push("/reports/weekly")}
          />
        );
      },
    },
    [],
  );

  // Human-in-the-loop: show the drafted follow-up email for approval before logging it.
  useHumanInTheLoop({
    agentId: "strands_agent",
    name: "confirm_followup",
    description:
      "Show the drafted follow-up email to the user for approval before logging it.",
    parameters: z.object({
      dealId: z.string(),
      to: z.string(),
      subject: z.string(),
      body: z.string(),
    }),
    render: ({
      args,
      status,
      respond,
    }: {
      args?: { to?: string; subject?: string; body?: string; dealId?: string };
      status: string;
      respond?: (value: { approved: boolean; body?: string }) => void;
    }) => (
      <FollowupApprovalCard
        to={args?.to ?? ""}
        subject={args?.subject ?? ""}
        body={args?.body ?? ""}
        status={status}
        onRespond={(v) => respond?.(v)}
      />
    ),
  });

  // Frontend tool: focus/select a deal in the UI so its details are shown.
  useFrontendTool({
    name: "focus_deal",
    description:
      "Select/focus a deal in the UI so its details are shown. Pure UI action.",
    parameters: z.object({ dealId: z.string() }),
    handler: async ({ dealId }) => {
      openDeal(dealId);
      return { status: "success" };
    },
  });

  // Frontend tool: navigate the workspace to a top-level page.
  useFrontendTool({
    name: "navigate_to",
    description:
      'Navigate the workspace to a top-level page. Use when the user asks to see/open/go to a page (e.g. "show me the pipeline", "open products", "take me to the team page"). Pure UI action.',
    parameters: z.object({ page: z.enum(PAGE_KEYS) }),
    handler: async ({ page }) => {
      router.push(pageToRoute(page));
      return { status: "success", page };
    },
  });

  // Chat suggestions: always-visible quick-action pills.
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Research CopilotKit",
        message:
          "Research CopilotKit and show me talking points for selling them laptops.",
      },
      {
        title: "Quote a fleet",
        message: "Recommend a laptop fleet quote for CopilotKit (30 seats).",
      },
      {
        title: "Team performance",
        message: "How is the sales team tracking this quarter?",
      },
      { title: "Weekly report", message: "Generate this week's sales report." },
    ],
    available: "always",
  });
}

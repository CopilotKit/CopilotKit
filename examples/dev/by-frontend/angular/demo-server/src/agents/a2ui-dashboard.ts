import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";

const A2UI_DASHBOARD_CATALOG_ID = "copilotkit://angular-dashboard-catalog";

interface DashboardData {
  revenue: string;
  revenueDelta: string;
  deals: string;
  winRate: string;
  winRateDelta: string;
}

const SNAPSHOTS: DashboardData[] = [
  {
    revenue: "$4.2M",
    revenueDelta: "+12%",
    deals: "38",
    winRate: "31%",
    winRateDelta: "-3%",
  },
  {
    revenue: "$4.6M",
    revenueDelta: "+9%",
    deals: "41",
    winRate: "34%",
    winRateDelta: "+3%",
  },
];

/**
 * The dashboard is a fixed component tree bound to the data model: basic
 * components (Column, Row, Button, Text) mixed with the custom ones the
 * Angular demo registers (Card with a title, Metric, StatusBadge, InfoRow,
 * BarChart).
 */
function dashboardOperations(data: DashboardData): unknown[] {
  const surfaceId = "dashboard";
  return [
    {
      version: "v0.9",
      createSurface: { surfaceId, catalogId: A2UI_DASHBOARD_CATALOG_ID },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId,
        components: [
          {
            id: "root",
            component: "Column",
            children: ["kpis", "pipeline", "actions"],
          },
          {
            id: "kpis",
            component: "Row",
            children: ["revenue", "deals", "win-rate"],
          },
          {
            id: "revenue",
            component: "Metric",
            label: "Revenue",
            value: { path: "/revenue" },
            trend: "up",
            trendValue: { path: "/revenueDelta" },
          },
          {
            id: "deals",
            component: "Metric",
            label: "Open deals",
            value: { path: "/deals" },
            trend: "neutral",
          },
          {
            id: "win-rate",
            component: "Metric",
            label: "Win rate",
            value: { path: "/winRate" },
            trend: data.winRateDelta.startsWith("-") ? "down" : "up",
            trendValue: { path: "/winRateDelta" },
          },
          {
            id: "pipeline",
            component: "Card",
            title: "Pipeline health",
            subtitle: "Q3 · EMEA",
            child: "pipeline-body",
          },
          {
            id: "pipeline-body",
            component: "Column",
            children: ["status", "owner", "renewal", "stages"],
          },
          {
            id: "status",
            component: "StatusBadge",
            text: "At risk",
            variant: "warning",
          },
          {
            id: "owner",
            component: "InfoRow",
            label: "Owner",
            value: "Ada Lovelace",
          },
          {
            id: "renewal",
            component: "InfoRow",
            label: "Renewal",
            value: "Oct 1",
          },
          {
            id: "stages",
            component: "BarChart",
            title: "Deals by stage",
            data: [
              { label: "Lead", value: 14 },
              { label: "Qualified", value: 11 },
              { label: "Proposal", value: 8 },
              { label: "Won", value: 5 },
            ],
          },
          {
            id: "actions",
            component: "Row",
            justify: "end",
            children: ["refresh", "approve"],
          },
          {
            id: "refresh",
            component: "Button",
            child: "refresh-label",
            action: { event: { name: "refresh", context: {} } },
          },
          { id: "refresh-label", component: "Text", text: "Refresh" },
          {
            id: "approve",
            component: "Button",
            variant: "primary",
            child: "approve-label",
            action: {
              event: {
                name: "approve_plan",
                context: { revenue: { path: "/revenue" } },
              },
            },
          },
          { id: "approve-label", component: "Text", text: "Approve plan" },
        ],
      },
    },
    { version: "v0.9", updateDataModel: { surfaceId, path: "/", value: data } },
  ];
}

/** Module level: the runtime runs a fresh clone of the agent per request. */
let refreshes = 0;

interface A2UIUserAction {
  name?: string;
  context?: Record<string, unknown>;
}

/**
 * Scripted agent for the Angular A2UI demo; no LLM needed. Any message
 * renders the dashboard, "Refresh" renders it with new numbers, and
 * "Approve plan" replies with the approved revenue read from the data model.
 */
export class A2UIDashboardAgent extends AbstractAgent {
  clone(): A2UIDashboardAgent {
    return new A2UIDashboardAgent();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((observer) => {
      const emit = (event: Record<string, unknown>) =>
        observer.next(event as BaseEvent);
      const say = (text: string) => {
        const messageId = crypto.randomUUID();
        emit({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: "assistant",
        });
        emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text });
        emit({ type: EventType.TEXT_MESSAGE_END, messageId });
      };
      const renderDashboard = (data: DashboardData) =>
        emit({
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: crypto.randomUUID(),
          activityType: "a2ui-surface",
          content: { a2ui_operations: dashboardOperations(data) },
        });

      emit({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      });

      const action = (
        (input.forwardedProps as Record<string, unknown> | undefined)
          ?.a2uiAction as { userAction?: A2UIUserAction } | undefined
      )?.userAction;

      if (action?.name === "approve_plan") {
        say(`Plan approved at ${String(action.context?.revenue)} revenue.`);
      } else if (action?.name === "refresh") {
        refreshes += 1;
        renderDashboard(SNAPSHOTS[refreshes % SNAPSHOTS.length]!);
        say("Refreshed with the latest numbers.");
      } else {
        renderDashboard(SNAPSHOTS[0]!);
        say(
          "Here is the pipeline dashboard. Try Refresh or Approve plan; both send an A2UI action back to me.",
        );
      }

      emit({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      });
      observer.complete();
    });
  }
}

"use client";

/**
 * Automatic Learning, as the Intelligence web app composes it (app.tsx:
 * `LearningRefreshProvider` around the shell, `LearningWorkspaceRoute` /
 * `LearningRoute` as content, the space name reported to the breadcrumb),
 * fed by the Ledgerline adapter and the demo's fixed schedule.
 */
import { useState } from "react";
import {
  IntelligenceShell,
  INTELLIGENCE_BASE,
} from "../shell/intelligence-shell";
import type { ShellCrumb } from "../shell/intelligence-shell";
import { LearningPage } from "../learning/learning-page";
import { LearningRefreshProvider } from "../learning/learning-refresh-context";
import { LearningSchedule } from "../learning/learning-schedule";
import {
  learningContainerRoute,
  parseLearningTabSegment,
} from "../learning/learning-routes";
import type { LearningTabSegment } from "../learning/learning-routes";
import {
  ledgerlineLearningApi,
  LEDGERLINE_PROJECT_ID,
} from "../ledgerline-learning-api";

const TAB_LABELS: Record<LearningTabSegment, string> = {
  insights: "Insights",
  skills: "Skills",
  "analysis-results": "Analysis results",
  settings: "Settings",
};

export function LearningScreen(props: {
  readonly containerId: string | null;
  readonly tab: string | null;
}) {
  const [spaceLabel, setSpaceLabel] = useState<string | null>(null);
  const tab = parseLearningTabSegment(props.tab);
  const detail: ShellCrumb[] =
    props.containerId && spaceLabel
      ? [
          {
            label: spaceLabel,
            to: learningContainerRoute(INTELLIGENCE_BASE, props.containerId),
          },
          { label: TAB_LABELS[tab] },
        ]
      : [];
  return (
    <LearningRefreshProvider>
      <IntelligenceShell
        section={{
          label: "Automatic Learning",
          to: `${INTELLIGENCE_BASE}/learning`,
        }}
        detail={detail}
      >
        <LearningPage
          api={ledgerlineLearningApi}
          baseRoute={INTELLIGENCE_BASE}
          containerId={props.containerId}
          onBreadcrumbLabelChange={setSpaceLabel}
          projectId={LEDGERLINE_PROJECT_ID}
          tab={tab}
          scheduleCard={(manualAction, renderReadiness, presentation) => (
            <LearningSchedule
              manualAction={manualAction}
              renderReadiness={renderReadiness}
              presentation={presentation}
              projectId={LEDGERLINE_PROJECT_ID}
            />
          )}
        />
      </IntelligenceShell>
    </LearningRefreshProvider>
  );
}

"use client";

/**
 * Automatic Learning, exactly as the Intelligence web app composes it
 * (app.tsx: `LearningRefreshProvider` around the shell, `LearningSidebar` in the
 * sidebar slot, `LearningPage` as content), fed by the Ledgerline adapter.
 */
import { IntelligenceShell, INTELLIGENCE_BASE } from "../shell/intelligence-shell";
import { LearningPage } from "../learning/learning-page";
import { LearningRefreshProvider } from "../learning/learning-refresh-context";
import { LearningSidebar } from "../learning/learning-sidebar";
import { parseLearningTabSegment } from "../learning/learning-routes";
import { ledgerlineLearningApi, LEDGERLINE_PROJECT_ID } from "../ledgerline-learning-api";

export function LearningScreen(props: { readonly containerId: string | null; readonly tab: string | null }) {
  return (
    <LearningRefreshProvider>
      <IntelligenceShell
        section={{ label: "Automatic Learning", to: `${INTELLIGENCE_BASE}/learning` }}
        sidebar={
          <LearningSidebar api={ledgerlineLearningApi} baseRoute={INTELLIGENCE_BASE} projectId={LEDGERLINE_PROJECT_ID} />
        }
      >
        <LearningPage
          api={ledgerlineLearningApi}
          baseRoute={INTELLIGENCE_BASE}
          containerId={props.containerId}
          projectId={LEDGERLINE_PROJECT_ID}
          tab={parseLearningTabSegment(props.tab)}
        />
      </IntelligenceShell>
    </LearningRefreshProvider>
  );
}

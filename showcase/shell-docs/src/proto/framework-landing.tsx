/// <reference types="mdx" />
import type { ComponentType } from "react";
import type { MDXContent } from "mdx/types";
import { DocsBody, DocsPage } from "fumadocs-ui/layouts/spacious/page";
import { Feedback } from "@/components/feedback/client";
import { docsPageComponents, setDocsScope } from "@/components/docs-mdx";
import type { FrameworkOverviewProps } from "@/components/docs-mdx/showcase/framework-overview";
import type { FrameworkOverviewData } from "@/data/frameworks";
import { sendPageFeedback } from "@/lib/feedback";
import type { ResolvedLivePage } from "@/lib/live-docs";
import AgentSpecAfterFeatures from "@/content/framework-overviews/agent-spec/after-features.mdx";
import GoogleAdkAfterFeatures from "@/content/framework-overviews/google-adk/after-features.mdx";
import LangGraphAfterFeatures from "@/content/framework-overviews/langgraph-python/after-features.mdx";

/**
 * `src/content/framework-overviews/<slug>/after-features.mdx`, by URL slug: a
 * record shared by several slugs (`langgraph-typescript` reuses
 * `langgraph-python`'s) shows its CTA on the ones without a section, as in
 * shell-docs.
 */
const AFTER_FEATURES: Record<string, MDXContent> = {
  "agent-spec": AgentSpecAfterFeatures,
  "google-adk": GoogleAdkAfterFeatures,
  "langgraph-python": LangGraphAfterFeatures,
};

/**
 * A generated framework's landing (`/google-adk`), drawn from its overview
 * record as shell-docs' framework root drew it (Tier 1), through the same
 * `<FrameworkOverview>` the authored landings use in their `index.mdx`.
 */
export function FrameworkLanding({
  overview,
  scope,
  contentPath,
}: ResolvedLivePage & { overview: FrameworkOverviewData }) {
  setDocsScope(scope, { path: contentPath });
  const components = docsPageComponents(scope);
  const FrameworkOverview =
    components.FrameworkOverview as ComponentType<FrameworkOverviewProps>;
  const AfterFeatures =
    overview.hasAfterFeaturesMdx && scope.framework
      ? AFTER_FEATURES[scope.framework]
      : undefined;

  return (
    <DocsPage toc={[]}>
      <DocsBody>
        <FrameworkOverview
          {...overview}
          afterFeatures={
            AfterFeatures ? (
              <AfterFeatures components={components} />
            ) : undefined
          }
        />
      </DocsBody>
      <Feedback onSendAction={sendPageFeedback} />
    </DocsPage>
  );
}

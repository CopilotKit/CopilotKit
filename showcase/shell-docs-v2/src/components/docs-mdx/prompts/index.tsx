import type { ComponentProps, ReactNode } from "react";
import type { MDXComponents } from "mdx/types";
import type { DocsMdxContext } from "../context";
import { getIntegration } from "../data";
import { docsHref } from "../href";
import type { DocsScope } from "../scope";
import { ChannelsIntegrationPicker } from "./channels-integration-picker";
import { ChannelsStartPrompt } from "./channels-start-prompt";
import {
  LinkToCopilotCloud,
  QuickstartIntelligenceCta,
  SignUpSection,
} from "./cloud-links";
import {
  DocsTrackedCopy,
  DocsTrackedLink,
  OpsPlatformCTA,
  SignupLink,
} from "./conversion";
import { IntelligenceOnboardingPrompt } from "./intelligence-onboarding-prompt";
import { landingIntegrations } from "./landing-integrations";
import { NewLookAndFeelPreview } from "./new-look-and-feel";
import { PROMPT_DISPLAY_NAMES, ROOT_FRAMEWORK } from "./onboarding";
import { PageAgentPrompt } from "./page-agent-prompt";
import {
  LearningSetupPrompt,
  MemorySetupPrompt,
  RichThreadsSetupPrompt,
  WebMCPSetupPrompt,
} from "./setup-prompts";

type WithoutScope<T extends (props: never) => ReactNode> = Omit<
  Parameters<T>[0],
  "scope"
>;

/**
 * The prompt, CTA and conversion components the ported content uses, bound
 * to the page's scope (shell-docs' `docsComponents` entries and the
 * `docs-page-view.tsx` overrides that injected `frontend`, `backend` and
 * `fromPath`).
 */
export function promptComponents(
  scope: DocsScope,
  _ctx: DocsMdxContext,
): MDXComponents {
  return {
    /** The page's coding-agent prompt, named for the page's framework. */
    PageAgentPrompt: () => {
      // A surface with no framework in the URL is the Built-in Agent's.
      const slug = scope.framework ?? ROOT_FRAMEWORK;
      const name = getIntegration(slug)?.name;
      return (
        <PageAgentPrompt
          scope={scope}
          framework={
            name ? { slug, name: PROMPT_DISPLAY_NAMES[slug] ?? name } : undefined
          }
        />
      );
    },
    RichThreadsSetupPrompt: () => <RichThreadsSetupPrompt scope={scope} />,
    MemorySetupPrompt: () => <MemorySetupPrompt scope={scope} />,
    LearningSetupPrompt: () => <LearningSetupPrompt scope={scope} />,
    WebMCPSetupPrompt: () => <WebMCPSetupPrompt scope={scope} />,
    IntelligenceOnboardingPrompt: (
      props: WithoutScope<typeof IntelligenceOnboardingPrompt>,
    ) => <IntelligenceOnboardingPrompt {...props} scope={scope} />,
    ChannelsStartPrompt: (props: WithoutScope<typeof ChannelsStartPrompt>) => (
      <ChannelsStartPrompt {...props} scope={scope} />
    ),
    ChannelsIntegrationPicker: () => (
      <ChannelsIntegrationPicker integrations={landingIntegrations()} />
    ),
    QuickstartIntelligenceCta: () => <QuickstartIntelligenceCta scope={scope} />,
    OpsPlatformCTA: (props: WithoutScope<typeof OpsPlatformCTA>) => (
      <OpsPlatformCTA {...props} scope={scope} />
    ),
    SignupLink: (props: WithoutScope<typeof SignupLink>) => (
      <SignupLink {...props} scope={scope} />
    ),
    DocsTrackedLink: (props: ComponentProps<typeof DocsTrackedLink>) => (
      <DocsTrackedLink {...props} navigateTo={docsHref(props.href, scope)} />
    ),
    DocsTrackedCopy,
    SignUpSection,
    LinkToCopilotCloud,
    NewLookAndFeelPreview,
  };
}

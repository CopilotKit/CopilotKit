import type { ComponentProps, JSXElementConstructor } from "react";
import type { MDXComponents } from "mdx/types";
import {
  AdkIcon,
  Ag2Icon,
  AgnoIcon,
  AnthropicIcon,
  CrewaiIcon,
  DeepAgentsIcon,
  LanggraphIcon,
  LlamaIndexIcon,
  MastraIcon,
  MicrosoftIcon,
  PydanticAiIcon,
  SpringIcon,
  StrandsIcon,
} from "@/components/icons/framework-icons";
import type { DocsMdxContext } from "../context";
import type { DocsScope } from "../scope";
import { AgentCoreCommandTabs } from "./agentcore";
import { AngularFeatureCatalog, AngularSnippet } from "./angular";
import { ApiKeyHint } from "./api-key-hint";
import { DemoSource } from "./demo-source";
import { FeatureIntegrations, FeatureMatrix } from "./feature-support";
import { WhenAngularBackend, WhenFrameworkHas } from "./framework-gates";
import { FrameworkOverview } from "./framework-overview";
import { FrameworkSetup } from "./framework-setup";
import { InlineDemo } from "./inline-demo";
import { IntegrationGrid } from "./integration-grid";
import {
  IntelligenceFeatureCards,
  IntelligenceOverview,
} from "./intelligence";
import { Snippet, UnsupportedBox } from "./snippet";

/** A component's MDX props: what it takes minus what the map binds. */
type Authored<
  // oxlint-disable-next-line no-explicit-any -- any component's props
  C extends JSXElementConstructor<any>,
  Bound extends string,
> = Omit<ComponentProps<C>, Bound>;

/**
 * The showcase-driven components of the ported shell-docs content: code and
 * live demos from the showcase, framework gates, the per-framework setup
 * steps and landings, bound to the page's scope.
 */
export function showcaseComponents(
  scope: DocsScope,
  ctx: DocsMdxContext,
): MDXComponents {
  return {
    Snippet: (props: Authored<typeof Snippet, "scope">) => (
      <Snippet {...props} scope={scope} />
    ),
    InlineDemo: (props: Authored<typeof InlineDemo, "scope">) => (
      <InlineDemo {...props} scope={scope} />
    ),
    DemoSource,
    UnsupportedBox,
    FeatureIntegrations: (
      props: Authored<typeof FeatureIntegrations, "scope">,
    ) => <FeatureIntegrations {...props} scope={scope} />,
    FeatureMatrix: () => <FeatureMatrix scope={scope} />,
    WhenFrameworkHas: (props: Authored<typeof WhenFrameworkHas, "scope">) => (
      <WhenFrameworkHas {...props} scope={scope} />
    ),
    WhenAngularBackend: (
      props: Authored<typeof WhenAngularBackend, "scope">,
    ) => <WhenAngularBackend {...props} scope={scope} />,
    IntegrationGrid: (
      props: Authored<typeof IntegrationGrid, "scope" | "ctx">,
    ) => <IntegrationGrid {...props} scope={scope} ctx={ctx} />,
    FrameworkSetup: (
      props: Authored<typeof FrameworkSetup, "scope" | "ctx">,
    ) => <FrameworkSetup {...props} scope={scope} ctx={ctx} />,
    AngularSnippet,
    AngularFeatureCatalog,
    FrameworkOverview: (
      props: Authored<typeof FrameworkOverview, "scope" | "ctx">,
    ) => <FrameworkOverview {...props} scope={scope} ctx={ctx} />,
    IntelligenceOverview: () => <IntelligenceOverview scope={scope} />,
    IntelligenceFeatureCards: () => (
      <IntelligenceFeatureCards scope={scope} ctx={ctx} />
    ),
    AgentCoreCommandTabs: (
      props: Authored<typeof AgentCoreCommandTabs, "scope">,
    ) => <AgentCoreCommandTabs {...props} scope={scope} />,
    ApiKeyHint,
    // Framework marks authored inline, e.g. `frameworkIcon={<MastraIcon />}`.
    AdkIcon,
    Ag2Icon,
    AgnoIcon,
    AnthropicIcon,
    CrewaiIcon,
    DeepAgentsIcon,
    LanggraphIcon,
    LlamaIndexIcon,
    MastraIcon,
    MicrosoftIcon,
    PydanticAIIcon: PydanticAiIcon,
    PydanticAiIcon,
    SpringIcon,
    StrandsIcon,
    AwsStrandsIcon: StrandsIcon,
  };
}

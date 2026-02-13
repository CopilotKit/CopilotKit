import { IntegrationsSelectorLightDesktop } from "./integrations-index-selector/integrations-selector-light-desktop";
import { IntegrationsSelectorDarkDesktop } from "./integrations-index-selector/integrations-selector-dark-desktop";
import {
  KiteIconLight,
  KiteIconDark,
} from "./integrations-index-selector/kite-icon";
import { IntegrationsSelectorLightMobile } from "./integrations-index-selector/integrations-selector-light-mobile";
import { IntegrationsSelectorDarkMobile } from "./integrations-index-selector/integrations-selector-dark-mobile";
import { IntegrationLinkRoundedButton } from "./integration-link-button/integration-link-rounded-button";
import { ComponentType } from "react";
import {
  INTEGRATION_ORDER,
  IntegrationId,
  getIntegration,
} from "@/lib/integrations";
import { hasIntegrationFeature } from "@/lib/integration-features";
import { AgentSpecMarkIcon, A2AIcon } from "@/lib/icons/custom-icons";
import AdkIcon from "../ui/icons/adk";
import Ag2Icon from "../ui/icons/ag2";
import CrewaiIcon from "../ui/icons/crewai";
import DirectToLlmIcon from "../ui/icons/direct-to-llm";
import LanggraphIcon from "../ui/icons/langgraph";
import LlamaIndexIcon from "../ui/icons/llama-index";
import MastraIcon from "../ui/icons/mastra";
import AgnoIcon from "../ui/icons/agno";
import PydanticAiIcon from "../ui/icons/pydantic-ai";
import { MicrosoftIcon } from "../ui/icons/microsoft";
import { AwsStrandsIcon } from "../ui/icons/aws-strands";

// Icon mapping - component-specific
const INTEGRATION_ICONS: Record<
  IntegrationId,
  ComponentType<{ className?: string }>
> = {
  a2a: A2AIcon,
  adk: AdkIcon,
  ag2: Ag2Icon,
  "agent-spec": AgentSpecMarkIcon,
  agno: AgnoIcon,
  "crewai-flows": CrewaiIcon,
  "crewai-crews": CrewaiIcon,
  "direct-to-llm": DirectToLlmIcon,
  langgraph: LanggraphIcon,
  llamaindex: LlamaIndexIcon,
  mastra: MastraIcon,
  "pydantic-ai": PydanticAiIcon,
  "microsoft-agent-framework": MicrosoftIcon,
  "aws-strands": AwsStrandsIcon,
};

interface Integration {
  id: IntegrationId;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  href: string;
}

// Build integrations list from canonical order
const INTEGRATIONS: Integration[] = INTEGRATION_ORDER.map((id) => {
  const meta = getIntegration(id);
  return {
    id,
    label: meta.label,
    Icon: INTEGRATION_ICONS[id],
    href: meta.href,
  };
});

interface IntegrationsGridProps {
  targetPage?: string;
  suppressDirectToLLM?: boolean;
}

const IntegrationsGrid: React.FC<IntegrationsGridProps> = ({
  targetPage,
  suppressDirectToLLM = false,
}) => {
  const hasTargetPage = (
    integration: Integration,
    targetPage: string,
  ): boolean => {
    if (!targetPage) {
      return true;
    }

    // Use auto-generated feature mapping
    return hasIntegrationFeature(integration.id, targetPage);
  };

  const getHref = (integration: Integration) => {
    if (!targetPage) {
      return integration.href;
    }

    // Special case: direct-to-llm has pages in /guides/ subdirectory
    if (integration.id === "direct-to-llm") {
      return `${integration.href}/guides/${targetPage}`;
    }

    // For all other frameworks, append the target page
    return `${integration.href}/${targetPage}`;
  };

  let filteredIntegrations = INTEGRATIONS;

  // Filter out Direct to LLM if suppressed
  if (suppressDirectToLLM) {
    filteredIntegrations = filteredIntegrations.filter(
      (integration) => integration.id !== "direct-to-llm",
    );
  }

  // Filter out integrations that don't have the target page
  if (targetPage) {
    filteredIntegrations = filteredIntegrations.filter((integration) =>
      hasTargetPage(integration, targetPage),
    );
  }

  return (
    <div className="flex flex-row flex-wrap justify-center items-center gap-x-6 gap-y-6 my-8">
      {/* Large desktop: 4 columns (2xl+) */}
      <div className="hidden 2xl:flex items-center">
        {/* Kite icon - positioned separately to avoid SVG distortion */}
        <div className="relative flex items-center">
          <KiteIconLight className="block dark:hidden w-[120px] h-[120px]" />
          <KiteIconDark className="hidden dark:block w-[120px] h-[120px]" />
        </div>
        {/* Connectors SVG - overlaps with kite to attach to circle edge */}
        <div className="-ml-[40px]">
          <IntegrationsSelectorLightDesktop
            className="block dark:hidden"
            rows={Math.ceil(filteredIntegrations.length / 4)}
            rowHeight={60}
          />
          <IntegrationsSelectorDarkDesktop
            className="hidden dark:block"
            rows={Math.ceil(filteredIntegrations.length / 4)}
            rowHeight={60}
          />
        </div>
        <div className="grid grid-cols-4 gap-2">
          {filteredIntegrations.map((integration) => (
            <IntegrationLinkRoundedButton
              key={integration.id}
              label={integration.label}
              Icon={integration.Icon}
              href={getHref(integration)}
            />
          ))}
        </div>
      </div>
      {/* Small screens (below lg): 2 columns with 36px row height */}
      <div className="flex flex-row items-start gap-2 lg:hidden">
        <div className="-ml-11 shrink-0">
          <IntegrationsSelectorLightMobile
            className="block dark:hidden"
            rows={Math.ceil(filteredIntegrations.length / 2)}
            rowHeight={36}
          />
          <IntegrationsSelectorDarkMobile
            className="hidden dark:block"
            rows={Math.ceil(filteredIntegrations.length / 2)}
            rowHeight={36}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 -ml-5 pt-[90px]">
          {filteredIntegrations.map((integration) => (
            <IntegrationLinkRoundedButton
              key={integration.id}
              label={integration.label}
              Icon={integration.Icon}
              href={getHref(integration)}
            />
          ))}
        </div>
      </div>
      {/* Medium screens (lg to 2xl): 2 columns with 60px row height */}
      <div className="hidden lg:flex 2xl:hidden flex-row items-start gap-2">
        <div className="-ml-11 shrink-0">
          <IntegrationsSelectorLightMobile
            className="block dark:hidden"
            rows={Math.ceil(filteredIntegrations.length / 2)}
            rowHeight={60}
          />
          <IntegrationsSelectorDarkMobile
            className="hidden dark:block"
            rows={Math.ceil(filteredIntegrations.length / 2)}
            rowHeight={60}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 -ml-5 pt-[90px]">
          {filteredIntegrations.map((integration) => (
            <IntegrationLinkRoundedButton
              key={integration.id}
              label={integration.label}
              Icon={integration.Icon}
              href={getHref(integration)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export { IntegrationsGrid };
export type { IntegrationsGridProps };

import { IntegrationLinkButton } from "./integration-link-button";
import AdkIcon from "@/components/ui/icons/adk";
import Ag2Icon from "@/components/ui/icons/ag2";
import AgnoIcon from "@/components/ui/icons/agno";
import { AwsStrandsIcon } from "@/components/ui/icons/aws-strands";
import CrewaiIcon from "@/components/ui/icons/crewai";
import DirectToLlmIcon from "@/components/ui/icons/direct-to-llm";
import LanggraphIcon from "@/components/ui/icons/langgraph";
import LlamaIndexIcon from "@/components/ui/icons/llama-index";
import MastraIcon from "@/components/ui/icons/mastra";
import PydanticAiIcon from "@/components/ui/icons/pydantic-ai";
import { ComponentType } from "react";
import { MicrosoftIcon } from "@/components/ui/icons/microsoft";
import { AgentSpecMarkIcon, A2AIcon } from "@/lib/icons/custom-icons";
import {
  INTEGRATION_ORDER,
  IntegrationId,
  getIntegration,
} from "@/lib/integrations";

interface Integration {
  label: string;
  Icon: ComponentType<{ className?: string }>;
  href: string;
}

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

// Build integrations list from canonical order
const INTEGRATIONS: Integration[] = INTEGRATION_ORDER.map((id) => {
  const meta = getIntegration(id);
  return {
    label: meta.label,
    Icon: INTEGRATION_ICONS[id],
    href: meta.href,
  };
});

export const IntegrationButtonGroup = () => {
  return (
    <div className="grid grid-cols-1 gap-2 w-full min-[500px]:grid-cols-2 lg:grid-cols-3">
      {INTEGRATIONS.map((integration) => (
        <IntegrationLinkButton key={integration.label} {...integration} />
      ))}
    </div>
  );
};

import { IntegrationLinkButton } from "./integration-link-button"
import AdkIcon from "@/components/ui/icons/adk"
import Ag2Icon from "@/components/ui/icons/ag2"
import AgnoIcon from "@/components/ui/icons/agno"
import { AwsStrandsIcon } from "@/components/ui/icons/aws-strands"
import CrewaiIcon from "@/components/ui/icons/crewai"
import DirectToLlmIcon from "@/components/ui/icons/direct-to-llm"
import LanggraphIcon from "@/components/ui/icons/langgraph"
import LlamaIndexIcon from "@/components/ui/icons/llama-index"
import MastraIcon from "@/components/ui/icons/mastra"
import PydanticAiIcon from "@/components/ui/icons/pydantic-ai"
import { ComponentType } from "react"
import { MicrosoftIcon } from "@/components/ui/icons/microsoft"
interface Integration {
  label: string
  Icon: ComponentType<{ className?: string }>
  href: string
}

const INTEGRATIONS: Integration[] = [
  {
    label: "ADK",
    Icon: AdkIcon,
    href: "/integrations/adk",
  },
  {
    label: "AG2",
    Icon: Ag2Icon,
    href: "/integrations/ag2",
  },
  {
    label: "Agno",
    Icon: AgnoIcon,
    href: "/integrations/agno",
  },
  {
    label: "Microsoft Agent Framework",
    Icon: MicrosoftIcon,
    href: "/integrations/microsoft-agent-framework",
  },
  {
    label: "AWS Strands",
    Icon: AwsStrandsIcon,
    href: "/integrations/aws-strands",
  },
  {
    label: "CrewAI Flows",
    Icon: CrewaiIcon,
    href: "/integrations/crewai-flows",
  },
  {
    label: "CrewAI Crews",
    Icon: CrewaiIcon,
    href: "/integrations/crewai-crews",
  },
  {
    label: "Direct to LLM",
    Icon: DirectToLlmIcon,
    href: "/integrations/direct-to-llm",
  },
  {
    label: "LangGraph",
    Icon: LanggraphIcon,
    href: "/integrations/langgraph",
  },
  {
    label: "LlamaIndex",
    Icon: LlamaIndexIcon,
    href: "/integrations/llamaindex",
  },
  {
    label: "Mastra",
    Icon: MastraIcon,
    href: "/integrations/mastra",
  },
  {
    label: "Pydantic AI",
    Icon: PydanticAiIcon,
    href: "/integrations/pydantic-ai",
  },
]

export const IntegrationButtonGroup = () => {
  return (
    <div className="grid grid-cols-1 gap-2 w-full min-[500px]:grid-cols-2 lg:grid-cols-3">
      {INTEGRATIONS.map((integration) => (
        <IntegrationLinkButton key={integration.label} {...integration} />
      ))}
    </div>
  )
}

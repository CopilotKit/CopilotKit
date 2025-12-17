import { IntegrationLinkButton } from "./integration-link-button"
import A2AIcon from "@/components/ui/icons/a2a"
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
    label: "A2A",
    Icon: A2AIcon,
    href: "/a2a",
  },
  {
    label: "ADK",
    Icon: AdkIcon,
    href: "/adk",
  },
  {
    label: "AG2",
    Icon: Ag2Icon,
    href: "/ag2",
  },
  {
    label: "Agno",
    Icon: AgnoIcon,
    href: "/agno",
  },
  {
    label: "Microsoft Agent Framework",
    Icon: MicrosoftIcon,
    href: "/microsoft-agent-framework",
  },
  {
    label: "AWS Strands",
    Icon: AwsStrandsIcon,
    href: "/aws-strands",
  },
  {
    label: "CrewAI Flows",
    Icon: CrewaiIcon,
    href: "/crewai-flows",
  },
  {
    label: "CrewAI Crews",
    Icon: CrewaiIcon,
    href: "/crewai-crews",
  },
  {
    label: "Direct to LLM",
    Icon: DirectToLlmIcon,
    href: "/direct-to-llm",
  },
  {
    label: "LangGraph",
    Icon: LanggraphIcon,
    href: "/langgraph",
  },
  {
    label: "LlamaIndex",
    Icon: LlamaIndexIcon,
    href: "/llamaindex",
  },
  {
    label: "Mastra",
    Icon: MastraIcon,
    href: "/mastra",
  },
  {
    label: "Pydantic AI",
    Icon: PydanticAiIcon,
    href: "/pydantic-ai",
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

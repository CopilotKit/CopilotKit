import { useState, useEffect, ComponentType } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import ChevronDownIcon from "../icons/chevron"
import AdkIcon from "../icons/adk"
import Ag2Icon from "../icons/ag2"
import AgnoIcon from "../icons/agno"
import CrewaiIcon from "../icons/crewai"
import DirectToLlmIcon from "../icons/direct-to-llm"
import LanggraphIcon from "../icons/langgraph"
import LlamaIndexIcon from "../icons/llama-index"
import MastraIcon from "../icons/mastra"
import PydanticAiIcon from "../icons/pydantic-ai"
import IntegrationPuzzleIcon from "../icons/integration-puzzle"

export type Integration =
  | "adk"
  | "ag2"
  | "agno"
  | "crewai-flows"
  | "crewai-crews"
  | "direct-to-llm"
  | "langgraph"
  | "llamaindex"
  | "mastra"
  | "pydantic-ai"

interface IntegrationOption {
  label: string
  Icon: ComponentType<{ className?: string }>
  href: string
}

const INTEGRATION_OPTIONS: Record<Integration, IntegrationOption> = {
  adk: {
    label: "ADK",
    Icon: AdkIcon,
    href: "/integrations/adk",
  },
  ag2: {
    label: "AG2",
    Icon: Ag2Icon,
    href: "/integrations/ag2",
  },
  agno: {
    label: "Agno",
    Icon: AgnoIcon,
    href: "/integrations/agno",
  },
  "crewai-flows": {
    label: "CrewAI Flows",
    Icon: CrewaiIcon,
    href: "/integrations/crewai-flows",
  },
  "crewai-crews": {
    label: "CrewAI Crews",
    Icon: CrewaiIcon,
    href: "/integrations/crewai-crews",
  },
  "direct-to-llm": {
    label: "Direct to LLM",
    Icon: DirectToLlmIcon,
    href: "/integrations/direct-to-llm",
  },
  langgraph: {
    label: "LangGraph",
    Icon: LanggraphIcon,
    href: "/integrations/langgraph",
  },
  llamaindex: {
    label: "LlamaIndex",
    Icon: LlamaIndexIcon,
    href: "/integrations/llamaindex",
  },
  mastra: {
    label: "Mastra",
    Icon: MastraIcon,
    href: "/integrations/mastra",
  },
  "pydantic-ai": {
    label: "Pydantic AI",
    Icon: PydanticAiIcon,
    href: "/integrations/pydantic-ai",
  },
}

const DEFAULT_INTEGRATION: IntegrationOption = {
  label: "Select integration...",
  Icon: IntegrationPuzzleIcon,
  href: "/integrations",
}

interface IntegrationSelectorProps {
  selectedIntegration: Integration | null
  setSelectedIntegration: (integration: Integration | null) => void
}

const IntegrationSelector = ({
  selectedIntegration,
  setSelectedIntegration,
}: IntegrationSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()

  const integration = selectedIntegration
    ? INTEGRATION_OPTIONS[selectedIntegration]
    : DEFAULT_INTEGRATION

  const { Icon } = integration

  const handleIntegrationClick = (integrationKey: Integration) => {
    setSelectedIntegration(integrationKey)
    setIsOpen(false)
  }

  useEffect(() => {
    const isRootIntegration = pathname === "/integrations"

    if (!isRootIntegration) {
      const integrationId = pathname.split("/")[2]
      setSelectedIntegration(integrationId as Integration)
      return
    }

    if (isRootIntegration && selectedIntegration) setSelectedIntegration(null)
  }, [pathname])

  return (
    <div className="relative w-full">
      <div
        className="flex justify-between items-center p-2 mt-3 mb-3 w-full h-14 rounded-lg border cursor-pointer bg-white/50 border-[#0C1112]/10 dark:border-border dark:bg-foreground/5"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            setIsOpen(!isOpen)
          }
        }}
        tabIndex={0}
        role="button"
        aria-label="Toggle integration selector"
        aria-expanded={isOpen}
      >
        <div className="flex gap-2 items-center">
          <div className="flex justify-center items-center w-10 h-10 rounded-md bg-[#0C1112]/5 dark:bg-white/5">
            <Icon className="text-[#0C1112] dark:text-white" />
          </div>
          <span className="text-sm font-medium opacity-60">
            {integration.label}
          </span>
        </div>

        <ChevronDownIcon className="mr-1 w-4 h-4" />
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 w-full max-w-[275px] bg-[#F7F7FA] shadow-2xl dark:bg-[#0C1112] border border-border rounded-lg p-1 z-30 max-h-[325px] overflow-y-auto custom-scrollbar">
          {Object.entries(INTEGRATION_OPTIONS).map(
            ([key, { label, Icon: OptionIcon, href }]) => (
              <Link
                key={href}
                href={href}
                className="flex gap-4 items-center p-1 rounded-lg cursor-pointer hover:bg-[#0C1112]/5 dark:hover:bg-white/5 group"
                onClick={() => handleIntegrationClick(key as Integration)}
              >
                <div className="flex justify-center items-center w-10 h-10 rounded-md bg-[#0C1112]/5 dark:bg-white/5 group-hover:bg-[#BEC2FF] dark:group-hover:bg-[#7076D5] transition-all duration-200">
                  <OptionIcon className="text-[#0C1112] dark:text-white dark:group-hover:text-white transition-all duration-200" />
                </div>
                <span className="text-sm font-medium">{label}</span>
              </Link>
            )
          )}
        </div>
      )}
    </div>
  )
}

export default IntegrationSelector

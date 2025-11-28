import { useState, useEffect } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import ChevronDownIcon from "../icons/chevron"

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

const INTEGRATION_OPTIONS: Record<
  Integration,
  { label: string; icon: string; href: string; width: number; height: number }
> = {
  adk: {
    label: "ADK",
    icon: "/icons/sidebar/adk.svg",
    href: "/integrations/adk",
    width: 22,
    height: 22,
  },
  ag2: {
    label: "AG2",
    icon: "/icons/sidebar/ag2.svg",
    href: "/integrations/ag2",
    width: 22,
    height: 22,
  },
  agno: {
    label: "Agno",
    icon: "/icons/sidebar/agno.svg",
    href: "/integrations/agno",
    width: 19,
    height: 17,
  },
  "crewai-flows": {
    label: "CrewAI Flows",
    icon: "/icons/sidebar/crewai.svg",
    href: "/integrations/crewai-flows",
    width: 19,
    height: 22,
  },
  "crewai-crews": {
    label: "CrewAI Crews",
    icon: "/icons/sidebar/crewai.svg",
    href: "/integrations/crewai-crews",
    width: 19,
    height: 22,
  },
  "direct-to-llm": {
    label: "Direct to LLM",
    icon: "/icons/sidebar/direct-to-llm.svg",
    href: "/integrations/direct-to-llm",
    width: 22,
    height: 22,
  },
  langgraph: {
    label: "LangGraph",
    icon: "/icons/sidebar/langraph.svg",
    href: "/integrations/langgraph",
    width: 30,
    height: 16,
  },
  llamaindex: {
    label: "LlamaIndex",
    icon: "/icons/sidebar/llama-index.svg",
    href: "/integrations/llamaindex",
    width: 21,
    height: 21,
  },
  mastra: {
    label: "Mastra",
    icon: "/icons/sidebar/mastra.svg",
    href: "/integrations/mastra",
    width: 23,
    height: 23,
  },
  "pydantic-ai": {
    label: "Pydantic AI",
    icon: "/icons/sidebar/pydantic-ai.svg",
    href: "/integrations/pydantic-ai",
    width: 21,
    height: 18,
  },
}

const DEFAULT_INTEGRATION_LOGO = "/icons/sidebar/puzzle.svg"
const DEFAULT_INTEGRATION = {
  label: "Select integration...",
  icon: DEFAULT_INTEGRATION_LOGO,
  href: "/integrations",
  width: 20,
  height: 20,
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
  // const pathname = usePathname()

  const integration = selectedIntegration
    ? INTEGRATION_OPTIONS[selectedIntegration]
    : DEFAULT_INTEGRATION

  const handleIntegrationClick = (integration: Integration) => {
    setSelectedIntegration(integration)
    setIsOpen(false)
  }

  // useEffect(() => {
  //   const isRootIntegration = pathname === "/integrations"

  //   console.log({ isRootIntegration })
  //   if (isRootIntegration && selectedIntegration) setSelectedIntegration(null)
  // }, [selectedIntegration])

  return (
    <div className="relative w-full">
      <div
        className="flex justify-between items-center p-2 mt-3 mb-3 w-full h-14 rounded-lg border cursor-pointer border-border bg-foreground/5"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex gap-2 items-center">
          <div className="flex justify-center items-center w-10 h-10 rounded-md bg-white/5">
            <Image
              src={integration.icon}
              alt="Integration Logo"
              width={integration.width}
              height={integration.height}
            />
          </div>
          <span className="text-sm font-medium opacity-60">
            {integration.label}
          </span>
        </div>

        <ChevronDownIcon className="mr-1 w-4 h-4" />
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 w-full max-w-[275px] bg-[#0C1112] border border-border rounded-lg p-1 z-30 max-h-[325px] overflow-y-auto custom-scrollbar">
          {Object.entries(INTEGRATION_OPTIONS).map(([key, integration]) => (
            <Link
              key={integration.href}
              href={integration.href}
              className="flex gap-4 items-center p-1 rounded-lg cursor-pointer hover:bg-white/5 group"
              onClick={() => handleIntegrationClick(key as Integration)}
            >
              <div className="flex justify-center items-center w-10 h-10 rounded-md bg-white/5 group-hover:bg-[#7076D5] transition-all duration-200">
                <Image
                  src={integration.icon}
                  alt={integration.label}
                  width={integration.width}
                  height={integration.height}
                />
              </div>
              <span className="text-sm font-medium">{integration.label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default IntegrationSelector

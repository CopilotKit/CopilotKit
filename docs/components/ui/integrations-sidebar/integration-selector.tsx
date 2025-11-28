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
  { label: string; logoSrc: string; href: string }
> = {
  adk: {
    label: "ADK",
    logoSrc: "/icons/sidebar/adk.svg",
    href: "/integrations/adk",
  },
  ag2: {
    label: "AG2",
    logoSrc: "/icons/sidebar/ag2.svg",
    href: "/integrations/ag2",
  },
  agno: {
    label: "Agno",
    logoSrc: "/icons/sidebar/agno.svg",
    href: "/integrations/agno",
  },
  "crewai-flows": {
    label: "CrewAI Flows",
    logoSrc: "/icons/sidebar/crewai-flows.svg",
    href: "/integrations/crewai-flows",
  },
  "crewai-crews": {
    label: "CrewAI Crews",
    logoSrc: "/icons/sidebar/crewai-crews.svg",
    href: "/integrations/crewai-crews",
  },
  "direct-to-llm": {
    label: "Direct to LLM",
    logoSrc: "/icons/sidebar/direct-to-llm.svg",
    href: "/integrations/direct-to-llm",
  },
  langgraph: {
    label: "LangGraph",
    logoSrc: "/icons/sidebar/langgraph.svg",
    href: "/integrations/langgraph",
  },
  llamaindex: {
    label: "LlamaIndex",
    logoSrc: "/icons/sidebar/llamaindex.svg",
    href: "/integrations/llamaindex",
  },
  mastra: {
    label: "Mastra",
    logoSrc: "/icons/sidebar/mastra.svg",
    href: "/integrations/mastra",
  },
  "pydantic-ai": {
    label: "Pydantic AI",
    logoSrc: "/icons/sidebar/pydantic-ai.svg",
    href: "/integrations/pydantic-ai",
  },
}

const DEFAULT_INTEGRATION_LOGO = "/icons/sidebar/puzzle.svg"
const DEFAULT_INTEGRATION_TEXT = "Select integration..."

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

  const logoSrc = selectedIntegration
    ? `/icons/sidebar/${selectedIntegration}.svg`
    : DEFAULT_INTEGRATION_LOGO
  const integrationText = selectedIntegration
    ? INTEGRATION_OPTIONS[selectedIntegration].label
    : DEFAULT_INTEGRATION_TEXT

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
          <Image
            src={logoSrc}
            alt="Integration Logo"
            width={40}
            height={40}
            className="w-10 h-10"
          />
          <span className="text-sm font-medium opacity-60">
            {integrationText}
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
              className="flex gap-4 items-center p-1 rounded-lg cursor-pointer hover:bg-white/5"
              onClick={() => handleIntegrationClick(key as Integration)}
            >
              <div className="flex justify-center items-center">
                <Image
                  src={integration.logoSrc}
                  alt={integration.label}
                  width={40}
                  height={40}
                  className="w-10 h-10"
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

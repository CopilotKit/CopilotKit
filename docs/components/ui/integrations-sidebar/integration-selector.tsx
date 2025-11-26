import { useState } from "react"
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

const INTEGRATIONS: Integration[] = [
  "adk",
  "ag2",
  "agno",
  "crewai-flows",
  "crewai-crews",
  "direct-to-llm",
  "langgraph",
  "llamaindex",
  "mastra",
  "pydantic-ai",
] as const

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
  const logoSrc = selectedIntegration
    ? `/icons/sidebar/${selectedIntegration}.svg`
    : DEFAULT_INTEGRATION_LOGO
  const integrationText = selectedIntegration
    ? selectedIntegration
    : DEFAULT_INTEGRATION_TEXT

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
        <div className="absolute top-[calc(100%+8px)] left-0 w-full max-w-[275px]"></div>
      )}
    </div>
  )
}

export default IntegrationSelector

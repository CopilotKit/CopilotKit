import { IntegrationLinkButton } from "./integration-link-button"

const INTEGRATIONS = [
  {
    label: "ADK",
    icon: "/icons/sidebar/adk.svg",
    href: "/integrations/adk",
    width: 22,
    height: 22,
  },
  {
    label: "AG2",
    icon: "/icons/sidebar/ag2.svg",
    href: "/integrations/ag2",
    width: 22,
    height: 22,
  },
  {
    label: "Agno",
    icon: "/icons/sidebar/agno.svg",
    href: "/integrations/agno",
    width: 19,
    height: 17,
  },
  {
    label: "CrewAI Flows",
    icon: "/icons/sidebar/crewai.svg",
    href: "/integrations/crewai-flows",
    width: 19,
    height: 22,
  },
  {
    label: "CrewAI Crews",
    icon: "/icons/sidebar/crewai.svg",
    href: "/integrations/crewai-crews",
    width: 19,
    height: 22,
  },
  {
    label: "Direct to LLM",
    icon: "/icons/sidebar/direct-to-llm.svg",
    href: "/integrations/direct-to-llm",
    width: 22,
    height: 22,
  },
  {
    label: "LangGraph",
    icon: "/icons/sidebar/langraph.svg",
    href: "/integrations/langgraph",
    width: 30,
    height: 16,
  },
  {
    label: "LlamaIndex",
    icon: "/icons/sidebar/llama-index.svg",
    href: "/integrations/llamaindex",
    width: 21,
    height: 21,
  },
  {
    label: "Mastra",
    icon: "/icons/sidebar/mastra.svg",
    href: "/integrations/mastra",
    width: 23,
    height: 23,
  },
  {
    label: "Pydantic AI",
    icon: "/icons/sidebar/pydantic-ai.svg",
    href: "/integrations/pydantic-ai",
    width: 21,
    height: 18,
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

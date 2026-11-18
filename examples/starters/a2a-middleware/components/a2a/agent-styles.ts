/**
 * Agent styling utilities for consistent badge appearance.
 * LangGraph agents use green, ADK agents use blue.
 */

export type AgentStyle = {
  bgColor: string;
  textColor: string;
  borderColor: string;
  icon: string;
  framework?: string;
};

export function getAgentStyle(agentName: string): AgentStyle {
  if (!agentName) {
    return {
      bgColor: "bg-gray-100",
      textColor: "text-gray-700",
      borderColor: "border-gray-300",
      icon: "🤖",
      framework: "",
    };
  }

  const nameLower = agentName.toLowerCase();

  // LangGraph agents (green)
  if (nameLower.includes("research")) {
    return {
      bgColor: "bg-gradient-to-r from-emerald-100 to-green-100",
      textColor: "text-emerald-800",
      borderColor: "border-emerald-400",
      icon: "🔗",
      framework: "LangGraph",
    };
  }

  // ADK agents (blue)
  if (nameLower.includes("analysis")) {
    return {
      bgColor: "bg-gradient-to-r from-blue-100 to-sky-100",
      textColor: "text-blue-800",
      borderColor: "border-blue-400",
      icon: "✨",
      framework: "ADK",
    };
  }

  return {
    bgColor: "bg-gray-100",
    textColor: "text-gray-700",
    borderColor: "border-gray-300",
    icon: "🤖",
    framework: "",
  };
}

export function truncateTask(text: string, maxLength: number = 50): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

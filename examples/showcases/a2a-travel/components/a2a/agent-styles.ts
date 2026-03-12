/**
 * Agent Styling Utilities
 *
 * This module provides consistent styling for agent badges across the UI.
 * Each agent framework (LangGraph vs ADK) has distinct branding:
 * - LangGraph: Green/Emerald colors with 🔗 icon
 * - ADK: Blue/Sky colors with ✨ icon
 * - Orchestrator: Gray with no specific icon
 */

import { AgentStyle } from "../types";

/**
 * Get the styling configuration for an agent based on its name
 *
 * This function determines the visual branding (colors, icons, framework label)
 * for agent badges in the UI. It helps users visually distinguish between:
 * - LangGraph agents (Itinerary, Restaurant)
 * - ADK agents (Budget, Weather)
 * - The Orchestrator
 *
 * @param agentName - The name of the agent (case-insensitive)
 * @returns AgentStyle object with colors, icon, and framework label
 */
export function getAgentStyle(agentName: string): AgentStyle {
  // Handle undefined/null agentName gracefully
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

  // LangGraph agents - Green branding
  if (nameLower.includes("itinerary") || nameLower.includes("restaurant")) {
    return {
      bgColor: "bg-gradient-to-r from-emerald-100 to-green-100",
      textColor: "text-emerald-800",
      borderColor: "border-emerald-400",
      icon: "🔗",
      framework: "LangGraph",
    };
  }

  // ADK agents - Blue/Google branding
  if (nameLower.includes("budget") || nameLower.includes("weather")) {
    return {
      bgColor: "bg-gradient-to-r from-blue-100 to-sky-100",
      textColor: "text-blue-800",
      borderColor: "border-blue-400",
      icon: "✨",
      framework: "ADK",
    };
  }

  // Default/Unknown agent
  return {
    bgColor: "bg-gray-100",
    textColor: "text-gray-700",
    borderColor: "border-gray-300",
    icon: "🤖",
    framework: "",
  };
}

/**
 * Truncate long text with ellipsis
 *
 * Used to keep agent task descriptions readable in the UI
 * without taking up too much horizontal space.
 *
 * @param text - The text to truncate
 * @param maxLength - Maximum length before truncation (default: 50)
 * @returns Truncated text with "..." if needed
 */
export function truncateTask(text: string, maxLength: number = 50): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

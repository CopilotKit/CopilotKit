/**
 * MCPAppsCard - Explains the MCP Apps protocol
 *
 * MCP Apps are HTML/JS applications served by MCP servers that
 * render in sandboxed iframes. The MCP server controls the UI.
 */

"use client";

// Prompts for each pill
const PROMPTS = {
  Flights: "Search for flights to Paris next weekend",
  Hotels: "Find hotels in Tokyo for 3 nights",
  Trading: "Create a portfolio with $10,000 initial balance",
  Kanban: "Create a kanban board for my project",
  Calculator: "Open the calculator app",
  Todo: "Open the todo app",
};

interface MCPAppsCardProps {
  isActive: boolean;
  onPromptClick?: (prompt: string) => void;
}

export function MCPAppsCard({ isActive, onPromptClick }: MCPAppsCardProps) {
  return (
    <div className={`protocol-card ${isActive ? "active" : ""}`}>
      <div className="protocol-card-icon mcp">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8" />
          <path d="M12 17v4" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold mb-2">MCP Apps</h3>
      <p className="text-sm text-[var(--color-text-secondary)] mb-4">
        HTML/JS apps served by MCP servers, rendered in sandboxed iframes.
      </p>
      <div className="flex flex-wrap gap-2">
        {Object.entries(PROMPTS).map(([label, prompt]) => (
          <button key={label} className="prompt-pill text-xs" onClick={() => onPromptClick?.(prompt)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

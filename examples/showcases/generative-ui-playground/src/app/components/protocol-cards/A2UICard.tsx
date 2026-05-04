/**
 * A2UICard - Explains the A2UI protocol
 *
 * A2UI (Agent-to-UI) uses declarative JSON messages that the agent
 * composes at runtime. The AI agent controls the UI structure.
 */

"use client";

// Prompts for each pill - generic UI generation examples
const PROMPTS = {
  "Contact Form": "Create a contact form with name, email, and message fields",
  "Todo List": "Show me a todo list with 5 sample items",
  "Profile Card": "Generate a profile card for John Doe, Software Engineer",
};

interface A2UICardProps {
  isActive: boolean;
  onPromptClick?: (prompt: string) => void;
}

export function A2UICard({ isActive, onPromptClick }: A2UICardProps) {
  return (
    <div className={`protocol-card ${isActive ? "active" : ""}`}>
      <div className="protocol-card-icon a2ui">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold mb-2">A2UI</h3>
      <p className="text-sm text-[var(--color-text-secondary)] mb-4">
        Agent-composed declarative JSON UI, rendered dynamically at runtime.
      </p>
      <div className="flex flex-wrap gap-2">
        {Object.entries(PROMPTS).map(([label, prompt]) => (
          <button
            key={label}
            className="prompt-pill text-xs"
            onClick={() => onPromptClick?.(prompt)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

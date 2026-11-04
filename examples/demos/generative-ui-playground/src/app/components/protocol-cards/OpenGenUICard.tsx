/**
 * OpenGenUICard - Explains the Open Generative UI protocol
 *
 * Open Generative UI lets the agent generate complete HTML/CSS/JS UIs
 * on the fly, streamed live into the chat as sandboxed iframes.
 */

"use client";

const PROMPTS = {
  "Bar Chart":
    "Build a bar chart showing quarterly revenue: Q1 $2.1M, Q2 $3.4M, Q3 $2.8M, Q4 $4.2M",
  Spreadsheet: "Create a spreadsheet with sample sales data for 5 products",
  "3D Cube": "Show me a rotating 3D cube using Three.js",
  Calculator: "Build me a beautiful calculator app",
};

interface OpenGenUICardProps {
  isActive: boolean;
  onPromptClick?: (prompt: string) => void;
}

export function OpenGenUICard({ isActive, onPromptClick }: OpenGenUICardProps) {
  return (
    <div className={`protocol-card ${isActive ? "active" : ""}`}>
      <div className="protocol-card-icon opengenui">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold mb-2">Open Generative UI</h3>
      <p className="text-sm text-[var(--color-text-secondary)] mb-4">
        Agent-generated HTML/CSS/JS UIs streamed live into the chat.
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

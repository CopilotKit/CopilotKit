/**
 * StaticGenUICard - Explains the Static GenUI protocol
 *
 * Static GenUI uses pre-built React components that render when
 * backend tools are called. The frontend developer controls the UI.
 */

"use client";

// Prompts for each pill
const PROMPTS = {
  Weather: "What's the weather in Tokyo?",
  Stocks: "Get the stock price for AAPL",
  Tasks: "Create a task to review the quarterly report",
};

interface StaticGenUICardProps {
  isActive: boolean;
  onPromptClick?: (prompt: string) => void;
}

export function StaticGenUICard({ isActive, onPromptClick }: StaticGenUICardProps) {
  return (
    <div className={`protocol-card ${isActive ? "active" : ""}`}>
      <div className="protocol-card-icon static">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 9h6v6H9z" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold mb-2">Static GenUI</h3>
      <p className="text-sm text-[var(--color-text-secondary)] mb-4">
        Pre-built React components rendered by the frontend when tools are called.
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

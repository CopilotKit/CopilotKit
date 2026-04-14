"use client";

/**
 * TaskApprovalCard - Human-in-the-Loop component for task confirmation
 *
 * Demonstrates CopilotKit's useHumanInTheLoop pattern where the AI
 * pauses execution to request user approval before proceeding.
 * Uses glassmorphism styling consistent with the mcp-apps design system.
 */

interface TaskApprovalCardProps {
  taskTitle: string;
  taskDescription: string;
  impact?: string;
  onApprove: () => void;
  onReject: () => void;
}

export function TaskApprovalCard({ taskTitle, taskDescription, impact, onApprove, onReject }: TaskApprovalCardProps) {
  return (
    <div className="glass-card p-5 max-w-md border-l-4 border-l-[var(--color-lilac)]">
      {/* Header with approval indicator */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-[var(--color-lilac)]/20 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-[var(--color-lilac-dark)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div>
          <p className="text-xs font-medium text-[var(--color-lilac-dark)] uppercase tracking-wide mb-1">
            Approval Required
          </p>
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{taskTitle}</h3>
        </div>
      </div>

      {/* Task description */}
      <div className="mb-4 p-3 rounded-lg bg-[var(--color-glass-subtle)]">
        <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{taskDescription}</p>
      </div>

      {/* Impact section if provided */}
      {impact && (
        <div className="mb-4 flex items-start gap-2">
          <svg
            className="w-4 h-4 text-[var(--color-text-tertiary)] mt-0.5 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="text-xs font-medium text-[var(--color-text-tertiary)] mb-1">Impact</p>
            <p className="text-sm text-[var(--color-text-secondary)]">{impact}</p>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3 pt-4 border-t border-[var(--color-border-glass)]">
        <button
          onClick={onReject}
          className="flex-1 px-4 py-2.5 rounded-lg border border-[var(--color-border)]
                     text-sm font-medium text-[var(--color-text-secondary)]
                     hover:bg-[var(--color-glass-subtle)] hover:border-[var(--color-border-light)]
                     transition-all duration-200 active:scale-[0.98]"
        >
          <span className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Reject
          </span>
        </button>
        <button
          onClick={onApprove}
          className="flex-1 px-4 py-2.5 rounded-lg
                     bg-gradient-to-r from-[var(--color-lilac)] to-[var(--color-mint)]
                     text-sm font-medium text-white
                     hover:opacity-90 hover:shadow-lg hover:shadow-[var(--color-lilac)]/25
                     transition-all duration-200 active:scale-[0.98]"
        >
          <span className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Approve
          </span>
        </button>
      </div>

      {/* Footer note */}
      <p className="text-xs text-[var(--color-text-tertiary)] text-center mt-3">
        The AI is waiting for your decision to proceed
      </p>
    </div>
  );
}

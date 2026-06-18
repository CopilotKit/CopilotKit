import type { ReactNode } from "react";

export type ApprovalCardProps = {
  title: string;
  detail: ReactNode;
  onApprove?: () => void;
  onDeny?: () => void;
  outcome?: string;
};

export function ApprovalCard({
  title,
  detail,
  onApprove,
  onDeny,
  outcome,
}: ApprovalCardProps) {
  return (
    <div
      style={{
        border: "1px solid #ccc",
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div style={{ fontWeight: "bold", marginBottom: 8 }}>{title}</div>
      <pre data-testid="approval-detail" style={{ whiteSpace: "pre-wrap" }}>
        {detail}
      </pre>
      {onApprove !== undefined && onDeny !== undefined && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button data-testid="approval-approve" onClick={onApprove}>
            Approve
          </button>
          <button data-testid="approval-deny" onClick={onDeny}>
            Deny
          </button>
        </div>
      )}
      {outcome !== undefined && (
        <div data-testid="approval-outcome">{outcome}</div>
      )}
    </div>
  );
}

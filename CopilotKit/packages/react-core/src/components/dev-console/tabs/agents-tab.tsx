import { DisplayContext } from "../types";

export function AvailableAgentsTab({ context }: { context: DisplayContext }) {
  const coagents = context.coagentStates || {};
  const agentNames = Object.keys(coagents);

  if (agentNames.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "48px 0", color: "#6b7280" }}>
        <p style={{ fontSize: "18px", margin: "0 0 8px 0" }}>No agents registered</p>
        <p style={{ fontSize: "14px", margin: 0 }}>
          Agents will appear here when registered with CopilotKit
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {agentNames.map((agentName: string) => (
        <div
          key={agentName}
          style={{
            backgroundColor: "white",
            padding: "16px",
            borderRadius: "8px",
            boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)",
            border: "1px solid #e5e7eb",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "#10b981",
              }}
            />
            <h3 style={{ fontWeight: "600", color: "#1f2937", margin: 0, fontSize: "16px" }}>
              {agentName}
            </h3>
          </div>
        </div>
      ))}
    </div>
  );
}

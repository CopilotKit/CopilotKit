import { AgentState, DisplayContext } from "../types";

export function AgentStatusTab({ context }: { context: DisplayContext }) {
  const agentStates = context.coagentStates || {};
  const agentStateEntries = Object.entries(agentStates);

  if (agentStateEntries.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "48px 0", color: "#6b7280" }}>
        <p style={{ fontSize: "18px", margin: "0 0 8px 0" }}>No agent states available</p>
        <p style={{ fontSize: "14px", margin: 0 }}>
          Agent states will appear here when agents are active
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {agentStateEntries.map(([agentName, state]: [string, AgentState]) => (
        <div
          key={agentName}
          style={{
            backgroundColor: "white",
            padding: "24px",
            borderRadius: "8px",
            boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)",
            border: "1px solid #e5e7eb",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "16px",
            }}
          >
            <h3 style={{ fontWeight: "600", fontSize: "18px", color: "#1f2937", margin: 0 }}>
              {agentName}
            </h3>
            <span
              style={{
                padding: "4px 12px",
                borderRadius: "9999px",
                fontSize: "12px",
                fontWeight: "500",
                backgroundColor:
                  state.status === "running"
                    ? "#dcfce7"
                    : state.status === "complete"
                      ? "#dbeafe"
                      : "#f3f4f6",
                color:
                  state.status === "running"
                    ? "#166534"
                    : state.status === "complete"
                      ? "#1e40af"
                      : "#1f2937",
              }}
            >
              {state.status || "idle"}
            </span>
          </div>

          {state.state && (
            <div style={{ marginBottom: "12px" }}>
              <p
                style={{
                  fontSize: "12px",
                  fontWeight: "500",
                  color: "#6b7280",
                  textTransform: "uppercase",
                  margin: "0 0 4px 0",
                }}
              >
                Current State:
              </p>
              <pre
                style={{
                  padding: "12px",
                  backgroundColor: "#f9fafb",
                  borderRadius: "4px",
                  fontSize: "12px",
                  overflowX: "auto",
                  margin: 0,
                }}
              >
                {JSON.stringify(state.state, null, 2)}
              </pre>
            </div>
          )}

          {state.running && (
            <div
              style={{
                marginTop: "16px",
                display: "flex",
                alignItems: "center",
                fontSize: "14px",
                color: "#4b5563",
              }}
            >
              <div style={{ marginRight: "8px" }}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  style={{ animation: "spin 1s linear infinite" }}
                >
                  <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    fill="none"
                    stroke="#4b5563"
                    strokeWidth="2"
                    strokeDasharray="9 3"
                  />
                </svg>
              </div>
              <span>Agent is currently running...</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

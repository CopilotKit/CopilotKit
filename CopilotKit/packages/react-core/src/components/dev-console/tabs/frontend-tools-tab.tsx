import { Action, ActionParameter, DisplayContext } from "../types";

export function FrontendToolsTab({ context }: { context: DisplayContext }) {
  const actions = Object.values(context.actions);
  // Frontend tools have status "remote" or "enabled"
  const frontendTools = actions.filter(
    (action: Action) => action.status === "remote" || action.status === "enabled",
  );

  if (frontendTools.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "48px 0", color: "#6b7280" }}>
        <p style={{ fontSize: "18px", margin: "0 0 8px 0" }}>No frontend tools defined</p>
        <p style={{ fontSize: "14px", margin: 0 }}>
          Frontend tools (useCopilotAction) will appear here when defined
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {frontendTools.map((tool: Action, index: number) => (
        <div
          key={index}
          style={{
            backgroundColor: "white",
            padding: "16px",
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
          }}
        >
          <h3
            style={{ fontWeight: "600", color: "#1f2937", margin: "0 0 6px 0", fontSize: "15px" }}
          >
            {tool.name}
          </h3>
          {tool.description && (
            <p
              style={{
                fontSize: "13px",
                color: "#6b7280",
                margin: "0 0 12px 0",
                lineHeight: "1.5",
              }}
            >
              {tool.description}
            </p>
          )}
          {tool.parameters && tool.parameters.length > 0 && (
            <div style={{ marginTop: "12px" }}>
              <p
                style={{
                  fontSize: "11px",
                  fontWeight: "600",
                  color: "#9ca3af",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  margin: "0 0 8px 0",
                }}
              >
                Parameters
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {tool.parameters.map((param: ActionParameter, pIndex: number) => (
                  <div
                    key={pIndex}
                    style={{
                      fontSize: "13px",
                      display: "flex",
                      alignItems: "baseline",
                      gap: "6px",
                    }}
                  >
                    <span style={{ fontFamily: "monospace", color: "#374151", fontWeight: "500" }}>
                      {param.name}
                    </span>
                    {param.type && (
                      <span style={{ fontSize: "12px", color: "#9ca3af" }}>{param.type}</span>
                    )}
                    {param.required && (
                      <span style={{ fontSize: "11px", color: "#ef4444", fontWeight: "600" }}>
                        REQUIRED
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

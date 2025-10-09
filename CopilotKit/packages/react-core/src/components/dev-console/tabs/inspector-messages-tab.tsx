import { InspectorMessage } from "../types";

export function InspectorMessagesTab({
  inspectorMessages,
}: {
  inspectorMessages: InspectorMessage[];
}) {
  if (inspectorMessages.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "48px 0", color: "#6b7280" }}>
        <p style={{ fontSize: "18px", margin: "0 0 8px 0" }}>No inspector messages</p>
        <p style={{ fontSize: "14px", margin: 0 }}>
          Important notifications and alerts will appear here
        </p>
      </div>
    );
  }

  const getSeverityStyles = (severity: "info" | "warning" | "error") => {
    switch (severity) {
      case "error":
        return {
          backgroundColor: "#fef2f2",
          border: "1px solid #fecaca",
          iconColor: "#dc2626",
          icon: "🔴",
        };
      case "warning":
        return {
          backgroundColor: "#fef3c7",
          border: "1px solid #fbbf24",
          iconColor: "#d97706",
          icon: "⚠️",
        };
      case "info":
      default:
        return {
          backgroundColor: "#eff6ff",
          border: "1px solid #bfdbfe",
          iconColor: "#2563eb",
          icon: "ℹ️",
        };
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {inspectorMessages.map((message) => {
        const styles = getSeverityStyles(message.severity);
        return (
          <div
            key={message.id}
            style={{
              backgroundColor: styles.backgroundColor,
              border: styles.border,
              borderRadius: "8px",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
              <span style={{ fontSize: "20px", lineHeight: "1" }}>{styles.icon}</span>
              <div style={{ flex: 1 }}>
                <h3
                  style={{
                    fontWeight: "600",
                    fontSize: "15px",
                    color: styles.iconColor,
                    margin: "0 0 4px 0",
                  }}
                >
                  {message.title}
                </h3>
                {message.description && (
                  <p
                    style={{
                      fontSize: "14px",
                      color: "#374151",
                      lineHeight: "1.5",
                      margin: "0",
                    }}
                  >
                    {message.description}
                  </p>
                )}
                {message.url && (
                  <a
                    href={message.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: "13px",
                      color: styles.iconColor,
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      marginTop: "8px",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                    onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                  >
                    Learn more →
                  </a>
                )}
                {message.timestamp && (
                  <p
                    style={{
                      fontSize: "12px",
                      color: "#6b7280",
                      margin: "8px 0 0 0",
                    }}
                  >
                    {new Date(message.timestamp).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

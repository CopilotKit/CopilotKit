import { useState } from "react";
import { Message, MessagesContext } from "../types";

export function MessagesTab({ messagesContext }: { messagesContext: MessagesContext }) {
  const messages = messagesContext.messages || [];
  const [viewMode, setViewMode] = useState<"formatted" | "json">("formatted");

  if (messages.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "48px 0", color: "#6b7280" }}>
        <p style={{ fontSize: "18px", margin: "0 0 8px 0" }}>No messages yet</p>
        <p style={{ fontSize: "14px", margin: 0 }}>
          Messages will appear here as the conversation progresses
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* View toggle */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          paddingBottom: "8px",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <button
          onClick={() => setViewMode("formatted")}
          style={{
            padding: "6px 12px",
            fontSize: "13px",
            fontWeight: "500",
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
            cursor: "pointer",
            backgroundColor: viewMode === "formatted" ? "#030507" : "white",
            color: viewMode === "formatted" ? "white" : "#4b5563",
            transition: "all 0.15s",
          }}
        >
          Formatted
        </button>
        <button
          onClick={() => setViewMode("json")}
          style={{
            padding: "6px 12px",
            fontSize: "13px",
            fontWeight: "500",
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
            cursor: "pointer",
            backgroundColor: viewMode === "json" ? "#030507" : "white",
            color: viewMode === "json" ? "white" : "#4b5563",
            transition: "all 0.15s",
          }}
        >
          JSON
        </button>
      </div>

      {viewMode === "formatted" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {messages.map((message: Message, index: number) => (
            <div
              key={index}
              style={{
                padding: "16px",
                borderRadius: "8px",
                backgroundColor:
                  message.role === "user"
                    ? "#eff6ff"
                    : message.role === "assistant"
                      ? "#f9fafb"
                      : "#fefce8",
                border: `1px solid ${message.role === "user" ? "#c7d2fe" : message.role === "assistant" ? "#e5e7eb" : "#fde047"}`,
                marginLeft: message.role === "user" ? "48px" : "0",
                marginRight: message.role === "assistant" ? "48px" : "0",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  marginBottom: "8px",
                }}
              >
                <span
                  style={{
                    fontWeight: "500",
                    fontSize: "14px",
                    color: "#374151",
                    textTransform: "capitalize",
                  }}
                >
                  {message.role || "system"}
                </span>
                {message.timestamp && (
                  <span style={{ fontSize: "12px", color: "#6b7280" }}>
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </span>
                )}
              </div>
              <div style={{ fontSize: "14px", color: "#1f2937", whiteSpace: "pre-wrap" }}>
                {message.content || ""}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            backgroundColor: "#1e1e1e",
            padding: "16px",
            borderRadius: "8px",
            overflow: "auto",
            maxHeight: "600px",
          }}
        >
          <pre
            style={{
              margin: 0,
              fontSize: "12px",
              fontFamily: "monospace",
              color: "#d4d4d4",
              lineHeight: "1.6",
            }}
          >
            {JSON.stringify(messages, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCopilotContext } from "../../context/copilot-context";
import { useCopilotMessagesContext } from "../../context/copilot-messages-context";
import { COPILOTKIT_VERSION } from "@copilotkit/shared";
import { useEffect, useState } from "react";
import { CheckIcon, CopilotKitIcon, ExclamationMarkTriangleIcon } from "./icons";

// Type definitions for the developer console
interface ActionParameter {
  name: string;
  required?: boolean;
  type?: string;
}

interface Action {
  name: string;
  description?: string;
  parameters?: ActionParameter[];
  status?: string;
}

interface Readable {
  name?: string;
  description?: string;
  value?: any;
  content?: string;
  metadata?: Record<string, any>;
}

interface AgentState {
  status?: string;
  state?: any;
  running?: boolean;
  lastUpdate?: number;
}

interface Message {
  id?: string;
  role?: "user" | "assistant" | "system";
  content?: string;
  timestamp?: number;
  [key: string]: any; // Allow additional properties from CopilotKit
}

interface Document {
  name?: string;
  content?: string;
  metadata?: Record<string, any>;
}

interface DisplayContext {
  actions: Record<string, Action>;
  getAllContext: () => Readable[];
  coagentStates: Record<string, AgentState>;
  getDocumentsContext: (args?: any[]) => Document[];
}

interface MessagesContext {
  messages: Message[];
}

interface DeveloperConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  hasApiKey: boolean;
}

export function DeveloperConsoleModal({ isOpen, onClose, hasApiKey }: DeveloperConsoleModalProps) {
  const context = useCopilotContext();
  const messagesContext = useCopilotMessagesContext();
  const [activeTab, setActiveTab] = useState("actions");

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Create mock data for preview when no API key
  const displayContext: DisplayContext = hasApiKey
    ? (context as DisplayContext)
    : {
        actions: {
          search_web: { name: "search_web", description: "Search the web for information" },
          send_email: { name: "send_email", description: "Send an email to a contact" },
          create_document: { name: "create_document", description: "Create a new document" },
          analyze_code: {
            name: "analyze_code",
            description: "Analyze code for issues and improvements",
          },
          generate_tests: {
            name: "generate_tests",
            description: "Generate unit tests for functions",
          },
        },
        getAllContext: () => [
          {
            content: "User preferences: dark mode enabled, TypeScript preferred",
            metadata: { source: "settings" },
          },
          {
            content: "Current project: Building a React application with CopilotKit",
            metadata: { source: "project" },
          },
          {
            content: "Recent activity: Implemented authentication system",
            metadata: { source: "activity" },
          },
          {
            content: "Development environment: VS Code, Node.js 18, React 18",
            metadata: { source: "environment" },
          },
        ],
        coagentStates: {
          "main-agent": { status: "active", lastUpdate: Date.now() },
          "code-assistant": { status: "active", lastUpdate: Date.now() - 15000 },
          "search-agent": { status: "idle", lastUpdate: Date.now() - 60000 },
        },
        getDocumentsContext: () => [
          {
            content: "README.md: Project setup and installation instructions",
            metadata: { type: "documentation" },
          },
          {
            content: "API Documentation: CopilotKit integration guide",
            metadata: { type: "documentation" },
          },
          {
            content: "package.json: Project dependencies and scripts",
            metadata: { type: "configuration" },
          },
        ],
      };

  const displayMessagesContext: MessagesContext = hasApiKey
    ? (messagesContext as MessagesContext)
    : {
        messages: [
          {
            id: "1",
            role: "user",
            content: "Help me implement a todo list with drag and drop functionality",
          },
          {
            id: "2",
            role: "assistant",
            content:
              "I'll help you create a todo list with drag and drop. Let me start by setting up the basic components and then add the drag and drop functionality using React DnD.",
          },
          { id: "3", role: "user", content: "Can you also add priority levels and due dates?" },
          {
            id: "4",
            role: "assistant",
            content:
              "Absolutely! I'll enhance the todo items with priority levels (high, medium, low) and due date functionality. This will make your todo list much more powerful for task management.",
          },
          { id: "5", role: "user", content: "Perfect! How about adding categories or tags?" },
        ],
      };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        backgroundColor: "rgba(0, 0, 0, 0.3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "1152px",
          maxWidth: "95vw",
          height: "80vh",
          backgroundColor: "white",
          borderRadius: "12px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "24px",
            borderBottom: "1px solid #e5e7eb",
            minHeight: "73px",
            flexShrink: 0,
            filter: !hasApiKey ? "blur(0.3px)" : "none",
            opacity: !hasApiKey ? 0.95 : 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <CopilotKitIcon />
            <h1
              style={{
                fontWeight: "bold",
                fontSize: "20px",
                color: "#1f2937",
                margin: 0,
              }}
            >
              Inspector
            </h1>
            <span
              style={{
                fontSize: "14px",
                color: "#6b7280",
                backgroundColor: "#f3f4f6",
                padding: "4px 8px",
                borderRadius: "4px",
              }}
            >
              v{COPILOTKIT_VERSION}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              color: "#9ca3af",
              fontSize: "24px",
              fontWeight: "300",
              border: "none",
              background: "none",
              cursor: "pointer",
              padding: "4px",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#4b5563")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#9ca3af")}
          >
            ×
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid #e5e7eb",
            backgroundColor: "#f9fafb",
            minHeight: "50px",
            flexShrink: 0,
            filter: !hasApiKey ? "blur(0.3px)" : "none",
            opacity: !hasApiKey ? 0.9 : 1,
          }}
        >
          {[
            { id: "actions", label: "Actions", count: Object.keys(displayContext.actions).length },
            { id: "readables", label: "Readables", count: displayContext.getAllContext().length },
            {
              id: "agent",
              label: "Agent Status",
              count: Object.keys(displayContext.coagentStates).length,
            },
            { id: "messages", label: "Messages", count: displayMessagesContext.messages.length },
            {
              id: "context",
              label: "Context",
              count: displayContext.getDocumentsContext([]).length,
            },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "12px 24px",
                fontSize: "14px",
                fontWeight: "500",
                border: "none",
                cursor: "pointer",
                backgroundColor: activeTab === tab.id ? "white" : "transparent",
                color: activeTab === tab.id ? "#2563eb" : "#6b7280",
                borderBottom: activeTab === tab.id ? "2px solid #2563eb" : "none",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                if (activeTab !== tab.id) {
                  e.currentTarget.style.color = "#1f2937";
                  e.currentTarget.style.backgroundColor = "#f3f4f6";
                }
              }}
              onMouseLeave={(e) => {
                if (activeTab !== tab.id) {
                  e.currentTarget.style.color = "#6b7280";
                  e.currentTarget.style.backgroundColor = "transparent";
                }
              }}
            >
              {tab.label}
              {tab.count > 0 && (
                <span
                  style={{
                    marginLeft: "8px",
                    backgroundColor: "#e5e7eb",
                    color: "#374151",
                    padding: "2px 8px",
                    borderRadius: "9999px",
                    fontSize: "12px",
                  }}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div
          style={{
            height: "calc(100% - 142px)",
            overflow: "auto",
            padding: "24px",
            backgroundColor: "#f9fafb",
            filter: !hasApiKey ? "blur(0.3px)" : "none",
            opacity: !hasApiKey ? 0.85 : 1,
          }}
        >
          {activeTab === "actions" && <ActionsTab context={displayContext} />}
          {activeTab === "readables" && <ReadablesTab context={displayContext} />}
          {activeTab === "agent" && <AgentStatusTab context={displayContext} />}
          {activeTab === "messages" && <MessagesTab messagesContext={displayMessagesContext} />}
          {activeTab === "context" && <ContextTab context={displayContext} />}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid #e5e7eb",
            backgroundColor: "white",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            minHeight: "57px",
            flexShrink: 0,
            filter: !hasApiKey ? "blur(0.3px)" : "none",
            opacity: !hasApiKey ? 0.9 : 1,
          }}
        >
          <div style={{ fontSize: "14px", color: "#6b7280" }}>
            <a
              href="https://github.com/CopilotKit/CopilotKit/issues"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#2563eb", textDecoration: "none" }}
              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
            >
              Report an issue
            </a>
          </div>
          <div style={{ fontSize: "14px", color: "#6b7280" }}>
            <a
              href="https://mcp.copilotkit.ai/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#2563eb", textDecoration: "none" }}
              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
            >
              Add MCP Server →
            </a>
          </div>
        </div>

        {/* Enhanced CTA Overlay */}
        {!hasApiKey && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(255, 255, 255, 0.2)",
              backdropFilter: "blur(2px)",
              WebkitBackdropFilter: "blur(2px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "12px",
              zIndex: 10,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => window.open("https://cloud.copilotkit.ai/sign-in", "_blank")}
              style={{
                // Following button system specifications
                height: "48px",
                padding: "12px 24px",
                backgroundColor: "#030507", // textPrimary token
                color: "#FFFFFF",
                borderRadius: "12px", // Medium radius token
                border: "none",
                cursor: "pointer",
                fontSize: "14px", // Medium Semi Bold typography
                fontWeight: "600",
                fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
                lineHeight: "22px",
                boxShadow: "0 4px 16px rgba(3, 5, 7, 0.2), 0 1px 3px rgba(3, 5, 7, 0.1)",
                transition: "all 200ms ease", // 200ms ease as per specs
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#575758"; // textSecondary token for hover
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow =
                  "0 6px 20px rgba(3, 5, 7, 0.25), 0 2px 4px rgba(3, 5, 7, 0.15)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "#030507";
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow =
                  "0 4px 16px rgba(3, 5, 7, 0.2), 0 1px 3px rgba(3, 5, 7, 0.1)";
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.backgroundColor = "#858589"; // textDisabled token for pressed
                e.currentTarget.style.transform = "translateY(0)";
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.backgroundColor = "#575758";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onFocus={(e) => {
                e.currentTarget.style.outline = "2px solid #BEC9FF";
                e.currentTarget.style.outlineOffset = "2px";
              }}
              onBlur={(e) => {
                e.currentTarget.style.outline = "none";
              }}
            >
              Get License Key
              <span style={{ fontSize: "16px", marginLeft: "-4px" }}>→</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Tab Components
function ActionsTab({ context }: { context: DisplayContext }) {
  const actions = Object.values(context.actions);

  if (actions.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "48px 0", color: "#6b7280" }}>
        <p style={{ fontSize: "18px", margin: "0 0 8px 0" }}>No actions available</p>
        <p style={{ fontSize: "14px", margin: 0 }}>Actions will appear here when registered</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {actions.map((action: Action, index: number) => (
        <div
          key={index}
          style={{
            backgroundColor: "white",
            padding: "16px",
            borderRadius: "8px",
            boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)",
            border: "1px solid #e5e7eb",
          }}
        >
          <div
            style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}
          >
            <div style={{ flex: 1 }}>
              <h3 style={{ fontWeight: "600", color: "#1f2937", margin: "0 0 4px 0" }}>
                {action.name}
              </h3>
              {action.description && (
                <p style={{ fontSize: "14px", color: "#4b5563", margin: "0 0 12px 0" }}>
                  {action.description}
                </p>
              )}
              {action.parameters && action.parameters.length > 0 && (
                <div style={{ marginTop: "12px" }}>
                  <p
                    style={{
                      fontSize: "12px",
                      fontWeight: "500",
                      color: "#6b7280",
                      textTransform: "uppercase",
                      margin: "0 0 4px 0",
                    }}
                  >
                    Parameters:
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {action.parameters.map((param: ActionParameter, pIndex: number) => (
                      <div key={pIndex} style={{ fontSize: "14px" }}>
                        <span style={{ fontFamily: "monospace", color: "#374151" }}>
                          {param.name}
                        </span>
                        {param.required && (
                          <span style={{ marginLeft: "4px", fontSize: "12px", color: "#ef4444" }}>
                            *required
                          </span>
                        )}
                        {param.type && (
                          <span style={{ marginLeft: "8px", fontSize: "12px", color: "#6b7280" }}>
                            ({param.type})
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div style={{ marginLeft: "16px" }}>
              {action.status === "available" ? <CheckIcon /> : <ExclamationMarkTriangleIcon />}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReadablesTab({ context }: { context: DisplayContext }) {
  const readables = context.getAllContext();

  if (readables.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "48px 0", color: "#6b7280" }}>
        <p style={{ fontSize: "18px", margin: "0 0 8px 0" }}>No readable context available</p>
        <p style={{ fontSize: "14px", margin: 0 }}>
          Readable context will appear here when provided
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {readables.map((readable: Readable, index: number) => (
        <div
          key={index}
          style={{
            backgroundColor: "white",
            padding: "16px",
            borderRadius: "8px",
            boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)",
            border: "1px solid #e5e7eb",
          }}
        >
          <div
            style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}
          >
            <div style={{ flex: 1 }}>
              <h3 style={{ fontWeight: "600", color: "#1f2937", margin: "0 0 4px 0" }}>
                {readable.name || `Readable ${index + 1}`}
              </h3>
              {readable.description && (
                <p style={{ fontSize: "14px", color: "#4b5563", margin: "0 0 12px 0" }}>
                  {readable.description}
                </p>
              )}
              {readable.value && (
                <pre
                  style={{
                    marginTop: "12px",
                    padding: "8px",
                    backgroundColor: "#f9fafb",
                    borderRadius: "4px",
                    fontSize: "12px",
                    overflowX: "auto",
                    margin: "12px 0 0 0",
                  }}
                >
                  {JSON.stringify(readable.value, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentStatusTab({ context }: { context: DisplayContext }) {
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

function MessagesTab({ messagesContext }: { messagesContext: MessagesContext }) {
  const messages = messagesContext.messages || [];

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
  );
}

function ContextTab({ context }: { context: DisplayContext }) {
  const documents = context.getDocumentsContext([]);

  if (documents.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "48px 0", color: "#6b7280" }}>
        <p style={{ fontSize: "18px", margin: "0 0 8px 0" }}>No document context available</p>
        <p style={{ fontSize: "14px", margin: 0 }}>
          Document context will appear here when provided
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {documents.map((doc: Document, index: number) => (
        <div
          key={index}
          style={{
            backgroundColor: "white",
            padding: "16px",
            borderRadius: "8px",
            boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.1)",
            border: "1px solid #e5e7eb",
          }}
        >
          <h3 style={{ fontWeight: "600", color: "#1f2937", margin: "0 0 8px 0" }}>
            {doc.name || `Document ${index + 1}`}
          </h3>
          {doc.content && (
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
              {doc.content}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

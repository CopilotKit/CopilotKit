"use client";

import { useCopilotContext } from "../../context/copilot-context";
import { useCopilotMessagesContext } from "../../context/copilot-messages-context";
import { useEffect, useState, useRef } from "react";
import { CopilotKitIcon } from "./icons";
import {
  fetchNotifications,
  countUnreadNotifications,
  markNotificationsAsSeen,
  type Notification,
} from "../../utils/notifications";
import { DisplayContext, MessagesContext, InspectorMessage } from "./types";
import {
  ActionsTab,
  MessagesTab,
  ReadablesTab,
  AvailableAgentsTab,
  AgentStatusTab,
  FrontendToolsTab,
  InspectorMessagesTab,
} from "./tabs";
import { ModalHeader } from "./components/modal-header";
import { NotificationsPanel } from "./components/notifications-panel";
import { UpdateBanner } from "./components/update-banner";
import { SettingsMenu } from "./components/settings-menu";
import { COPILOTKIT_VERSION } from "@copilotkit/shared";

interface DeveloperConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onHideForDay: () => void;
  hasApiKey: boolean;
  buttonPosition: { x: number; y: number } | null;
  inspectorMessages?: InspectorMessage[];
}

export function DeveloperConsoleModal({
  isOpen,
  onClose,
  onHideForDay,
  hasApiKey,
  buttonPosition,
  inspectorMessages = [],
}: DeveloperConsoleModalProps) {
  const context = useCopilotContext();
  const messagesContext = useCopilotMessagesContext();

  // UI State
  const [activeTab, setActiveTab] = useState("messages");
  const [showMenu, setShowMenu] = useState(false);
  const [showNotificationsPanel, setShowNotificationsPanel] = useState(false);

  // Version checking
  const [isOutdated, setIsOutdated] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  // Notifications
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Modal sizing and resizing
  const [modalSize, setModalSize] = useState({ width: 800, height: 900 });
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{
    edge: string;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Handle resize
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current || !modalRef.current) return;

      const { edge, startX, startY, startWidth, startHeight } = resizeRef.current;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let newWidth = startWidth;
      let newHeight = startHeight;

      if (edge.includes("right")) {
        newWidth = Math.max(400, startWidth + deltaX);
      } else if (edge.includes("left")) {
        newWidth = Math.max(400, startWidth - deltaX);
      }

      if (edge.includes("bottom")) {
        newHeight = Math.max(300, startHeight + deltaY);
      } else if (edge.includes("top")) {
        newHeight = Math.max(300, startHeight - deltaY);
      }

      setModalSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
      document.body.style.cursor = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  // Check if version is outdated
  useEffect(() => {
    const checkVersion = async () => {
      try {
        const response = await fetch("https://registry.npmjs.org/@copilotkit/react-core/latest");
        const data = await response.json();
        const latest = data.version;

        // Compare versions (simple comparison)
        const current = COPILOTKIT_VERSION.replace(/[^\d.]/g, "");
        const latestClean = latest.replace(/[^\d.]/g, "");

        setLatestVersion(latest);
        setIsOutdated(current < latestClean);
      } catch (error) {
        // Silently fail - don't show warning if we can't check
        console.debug("Failed to check version:", error);
      }
    };

    if (isOpen) {
      checkVersion();
    }
  }, [isOpen]);

  // Fetch notifications when modal opens
  useEffect(() => {
    const loadNotifications = async () => {
      try {
        // TODO: Accept RSS feed URL as prop and pass it here
        const notifs = await fetchNotifications();
        setNotifications(notifs);
        setUnreadCount(countUnreadNotifications(notifs));
      } catch (error) {
        console.debug("Failed to load notifications:", error);
      }
    };

    if (isOpen) {
      loadNotifications();
    }
  }, [isOpen]);

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

  // Calculate modal position based on button position
  const calculateModalPosition = () => {
    if (!buttonPosition) return { top: "16px", left: "16px", transformOrigin: "top left" };

    const modalWidth = 800;
    const maxModalHeight = 900;
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1920;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 1080;
    const buttonSize = 36;
    const margin = 16;

    let position: any = {};
    let transformOrigin = "";

    // Calculate available space in each direction from button
    const spaceRight = viewportWidth - (buttonPosition.x + buttonSize);
    const spaceLeft = buttonPosition.x;
    const spaceBelow = viewportHeight - (buttonPosition.y + buttonSize);
    const spaceAbove = buttonPosition.y;

    // Determine horizontal placement (prefer right if button is on left half)
    const placeRight = buttonPosition.x < viewportWidth / 2;

    // Determine vertical placement
    // Check if modal fits below button
    const fitsBelow = spaceBelow >= Math.min(maxModalHeight, viewportHeight - 2 * margin);
    // Check if modal fits above button
    const fitsAbove = spaceAbove >= Math.min(maxModalHeight, viewportHeight - 2 * margin);

    if (placeRight) {
      // Place modal to the right of button, align left edges
      position.left = `${buttonPosition.x}px`;

      if (fitsBelow) {
        // Extend downward, align top of modal with top of button
        position.top = `${buttonPosition.y}px`;
        transformOrigin = "top left";
      } else if (fitsAbove) {
        // Extend upward, align bottom of modal with bottom of button
        position.bottom = `${viewportHeight - buttonPosition.y - buttonSize}px`;
        transformOrigin = "bottom left";
      } else {
        // Doesn't fit either direction, stick to top with margin
        position.top = `${margin}px`;
        transformOrigin = "top left";
      }
    } else {
      // Place modal to the left of button, align right edges
      position.right = `${viewportWidth - buttonPosition.x - buttonSize}px`;

      if (fitsBelow) {
        // Extend downward, align top of modal with top of button
        position.top = `${buttonPosition.y}px`;
        transformOrigin = "top right";
      } else if (fitsAbove) {
        // Extend upward, align bottom of modal with bottom of button
        position.bottom = `${viewportHeight - buttonPosition.y - buttonSize}px`;
        transformOrigin = "bottom right";
      } else {
        // Doesn't fit either direction, stick to top with margin
        position.top = `${margin}px`;
        transformOrigin = "top right";
      }
    }

    return { ...position, transformOrigin };
  };

  const modalPosition = calculateModalPosition();

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

  const handleToggleNotifications = () => {
    setShowNotificationsPanel(!showNotificationsPanel);
    if (!showNotificationsPanel) {
      // Mark as seen when opening
      markNotificationsAsSeen();
      setUnreadCount(0);
    }
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
      }}
      onClick={onClose}
    >
      <div
        ref={modalRef}
        style={{
          position: "fixed",
          ...modalPosition,
          width: `${modalSize.width}px`,
          maxWidth: "90vw",
          height: `${modalSize.height}px`,
          maxHeight: "calc(100vh - 100px)",
          backgroundColor: "white",
          borderRadius: "12px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          display: "flex",
          flexDirection: "row",
          overflow: "hidden",
          animation: "slideIn 0.2s ease-out",
          transformOrigin: modalPosition.transformOrigin,
          margin: "8px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Resize handles */}
        {[
          "top",
          "right",
          "bottom",
          "left",
          "top-right",
          "top-left",
          "bottom-right",
          "bottom-left",
        ].map((edge) => (
          <div
            key={edge}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              resizeRef.current = {
                edge,
                startX: e.clientX,
                startY: e.clientY,
                startWidth: modalSize.width,
                startHeight: modalSize.height,
              };
              setIsResizing(true);
              document.body.style.cursor =
                edge.includes("top") || edge.includes("bottom")
                  ? edge.includes("left") || edge.includes("right")
                    ? edge === "top-left" || edge === "bottom-right"
                      ? "nwse-resize"
                      : "nesw-resize"
                    : "ns-resize"
                  : "ew-resize";
            }}
            style={{
              position: "absolute",
              ...(edge === "top" && {
                top: 0,
                left: "8px",
                right: "8px",
                height: "4px",
                cursor: "ns-resize",
              }),
              ...(edge === "right" && {
                right: 0,
                top: "8px",
                bottom: "8px",
                width: "4px",
                cursor: "ew-resize",
              }),
              ...(edge === "bottom" && {
                bottom: 0,
                left: "8px",
                right: "8px",
                height: "4px",
                cursor: "ns-resize",
              }),
              ...(edge === "left" && {
                left: 0,
                top: "8px",
                bottom: "8px",
                width: "4px",
                cursor: "ew-resize",
              }),
              ...(edge === "top-right" && {
                top: 0,
                right: 0,
                width: "12px",
                height: "12px",
                cursor: "nesw-resize",
              }),
              ...(edge === "top-left" && {
                top: 0,
                left: 0,
                width: "12px",
                height: "12px",
                cursor: "nwse-resize",
              }),
              ...(edge === "bottom-right" && {
                bottom: 0,
                right: 0,
                width: "12px",
                height: "12px",
                cursor: "nwse-resize",
              }),
              ...(edge === "bottom-left" && {
                bottom: 0,
                left: 0,
                width: "12px",
                height: "12px",
                cursor: "nesw-resize",
              }),
              zIndex: 10,
            }}
          />
        ))}
        <style>{`
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: scale(0.95);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }
        `}</style>

        {/* Sidebar */}
        <div
          style={{
            width: "200px",
            backgroundColor: "#f9fafb",
            borderRight: "1px solid #e5e7eb",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
          }}
        >
          {/* Sidebar Header with CopilotKit branding */}
          <div
            style={{
              padding: "16px",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <CopilotKitIcon />
            <span
              style={{
                fontSize: "18px",
                fontWeight: "600",
                color: "#030507",
              }}
            >
              CopilotKit
            </span>
          </div>

          {/* Tabs */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              padding: "12px",
              flex: 1,
            }}
          >
            {[
              { id: "messages", label: "Messages" },
              {
                id: "inspector-messages",
                label: "Inspector Messages",
                badge: inspectorMessages.length,
              },
              { id: "actions", label: "Actions" },
              { id: "readables", label: "Readables" },
              { id: "agents", label: "Available Agents" },
              { id: "agent-state", label: "Agent State" },
              { id: "tools", label: "Frontend Tools" },
              { id: "errors", label: "Errors" },
              { id: "events", label: "Events" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: "8px 12px",
                  fontSize: "14px",
                  fontWeight: "400",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  backgroundColor: activeTab === tab.id ? "white" : "transparent",
                  color: activeTab === tab.id ? "#030507" : "#6b7280",
                  textAlign: "left",
                  transition: "all 0.15s",
                  boxShadow: activeTab === tab.id ? "0 1px 3px rgba(0, 0, 0, 0.1)" : "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                }}
                onMouseEnter={(e) => {
                  if (activeTab !== tab.id) {
                    e.currentTarget.style.backgroundColor = "#ffffff";
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== tab.id) {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }
                }}
              >
                <span>{tab.label}</span>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span
                    style={{
                      backgroundColor: "#ef4444",
                      color: "white",
                      fontSize: "11px",
                      fontWeight: "600",
                      padding: "2px 6px",
                      borderRadius: "10px",
                      minWidth: "18px",
                      textAlign: "center",
                    }}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Main Content Area */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <ModalHeader
            isOutdated={isOutdated}
            unreadCount={unreadCount}
            showNotificationsPanel={showNotificationsPanel}
            showMenu={showMenu}
            onToggleNotifications={handleToggleNotifications}
            onClose={onClose}
            onToggleMenu={() => setShowMenu(!showMenu)}
          />

          {/* Notifications Panel */}
          {showNotificationsPanel && <NotificationsPanel notifications={notifications} />}

          {/* Settings Menu */}
          {showMenu && (
            <SettingsMenu onHideForDay={onHideForDay} onClose={() => setShowMenu(false)} />
          )}

          {/* Update Available Banner */}
          {isOutdated && latestVersion && (
            <UpdateBanner latestVersion={latestVersion} onDismiss={() => setIsOutdated(false)} />
          )}

          {/* Content */}
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: "20px",
              backgroundColor: "#f9fafb",
              position: "relative",
            }}
          >
            {activeTab === "messages" && <MessagesTab messagesContext={displayMessagesContext} />}
            {activeTab === "inspector-messages" && (
              <InspectorMessagesTab inspectorMessages={inspectorMessages} />
            )}
            {activeTab === "actions" && <ActionsTab context={displayContext} />}
            {activeTab === "readables" && <ReadablesTab context={displayContext} />}
            {activeTab === "agents" && <AvailableAgentsTab context={displayContext} />}
            {activeTab === "agent-state" && <AgentStatusTab context={displayContext} />}
            {activeTab === "tools" && <FrontendToolsTab context={displayContext} />}
            {activeTab === "errors" && (
              <div style={{ textAlign: "center", padding: "48px 0", color: "#6b7280" }}>
                <p style={{ fontSize: "16px", margin: "0 0 8px 0" }}>No errors</p>
                <p style={{ fontSize: "14px", margin: 0 }}>
                  Errors will appear here when they occur
                </p>
              </div>
            )}
            {activeTab === "events" && (
              <div style={{ textAlign: "center", padding: "48px 0", color: "#6b7280" }}>
                <p style={{ fontSize: "16px", margin: "0 0 8px 0" }}>No events</p>
                <p style={{ fontSize: "14px", margin: 0 }}>Events will be logged here</p>
              </div>
            )}

            {/* CTA Overlay on content area only */}
            {!hasApiKey && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: "rgba(255, 255, 255, 0.96)",
                  backdropFilter: "none",
                  WebkitBackdropFilter: "none",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "0",
                  zIndex: 10,
                  gap: "24px",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ textAlign: "center", maxWidth: "560px", padding: "0 32px" }}>
                  <h2
                    style={{
                      fontSize: "32px",
                      fontWeight: "600",
                      color: "#030507",
                      margin: "0 0 16px 0",
                      letterSpacing: "-0.5px",
                    }}
                  >
                    CopilotKit Inspector
                  </h2>
                  <p
                    style={{
                      fontSize: "16px",
                      color: "#4b5563",
                      lineHeight: "1.7",
                      margin: "0 0 16px 0",
                    }}
                  >
                    Debug and monitor your AI application in real-time. Track actions, agent state,
                    messages, context, and errors—all in one powerful tool.
                  </p>
                  <div
                    style={{
                      backgroundColor: "#f0f9ff",
                      border: "1px solid #bae6fd",
                      borderRadius: "8px",
                      padding: "16px",
                      margin: "0 0 24px 0",
                      textAlign: "left",
                    }}
                  >
                    <p
                      style={{
                        fontSize: "14px",
                        color: "#0c4a6e",
                        lineHeight: "1.6",
                        margin: "0 0 12px 0",
                        fontWeight: "500",
                      }}
                    >
                      ✓ Works with CopilotKit Cloud, self-hosted, or local license keys
                    </p>
                    <p
                      style={{
                        fontSize: "13px",
                        color: "#0369a1",
                        lineHeight: "1.5",
                        margin: "0",
                      }}
                    >
                      When using a local license key, all data stays on your machine—no external
                      requests are made.
                    </p>
                  </div>
                  <a
                    href="https://docs.copilotkit.ai/premium/inspector"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: "14px",
                      color: "#6366f1",
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                    onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                  >
                    Learn more about the Inspector
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M6 4L10 8L6 12"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </a>
                </div>
                <button
                  onClick={() => window.open("https://cloud.copilotkit.ai/sign-in", "_blank")}
                  style={{
                    height: "48px",
                    padding: "12px 24px",
                    backgroundColor: "#030507",
                    color: "#FFFFFF",
                    borderRadius: "12px",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: "600",
                    fontFamily:
                      "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
                    lineHeight: "22px",
                    boxShadow: "0 4px 16px rgba(3, 5, 7, 0.2), 0 1px 3px rgba(3, 5, 7, 0.1)",
                    transition: "all 200ms ease",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#575758";
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
                    e.currentTarget.style.backgroundColor = "#858589";
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
                  Setup free license
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Re-export the InspectorMessage type for use in other components
export type { InspectorMessage } from "./types";

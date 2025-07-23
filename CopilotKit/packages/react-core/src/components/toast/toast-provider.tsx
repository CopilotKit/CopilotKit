import { GraphQLError } from "@copilotkit/runtime-client-gql";
import React, { createContext, useContext, useState, useCallback } from "react";
import { PartialBy, CopilotKitError, Severity } from "@copilotkit/shared";

interface Toast {
  id: string;
  message: string | React.ReactNode;
  type: "info" | "success" | "warning" | "error";
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (toast: PartialBy<Toast, "id">) => void;
  addGraphQLErrorsToast: (errors: GraphQLError[]) => void;
  removeToast: (id: string) => void;
  enabled: boolean;
  // Banner management
  bannerError: CopilotKitError | null;
  setBannerError: (error: CopilotKitError | null) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

// Helper functions for error banner styling
type ErrorSeverity = "critical" | "warning" | "info";

interface ErrorColors {
  background: string;
  border: string;
  text: string;
  icon: string;
}

function getErrorSeverity(error: CopilotKitError): ErrorSeverity {
  // Use structured error severity if available
  if (error.severity) {
    switch (error.severity) {
      case Severity.CRITICAL:
        return "critical";
      case Severity.WARNING:
        return "warning";
      case Severity.INFO:
        return "info";
      default:
        return "info";
    }
  }

  // Fallback: Check for API key errors which should always be critical
  const message = error.message.toLowerCase();
  if (
    message.includes("api key") ||
    message.includes("401") ||
    message.includes("unauthorized") ||
    message.includes("authentication") ||
    message.includes("incorrect api key")
  ) {
    return "critical";
  }

  // Default to info level
  return "info";
}

function getErrorColors(severity: ErrorSeverity): ErrorColors {
  switch (severity) {
    case "critical":
      return {
        background: "#fee2e2",
        border: "#dc2626",
        text: "#7f1d1d",
        icon: "#dc2626",
      };
    case "warning":
      return {
        background: "#fef3c7",
        border: "#d97706",
        text: "#78350f",
        icon: "#d97706",
      };
    case "info":
      return {
        background: "#dbeafe",
        border: "#2563eb",
        text: "#1e3a8a",
        icon: "#2563eb",
      };
  }
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

export function ToastProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [bannerError, setBannerErrorState] = useState<CopilotKitError | null>(null);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback(
    (toast: PartialBy<Toast, "id">) => {
      // Respect the enabled flag for ALL toasts
      if (!enabled) {
        return;
      }

      const id = toast.id ?? Math.random().toString(36).substring(2, 9);

      setToasts((currentToasts) => {
        if (currentToasts.find((toast) => toast.id === id)) return currentToasts;
        return [...currentToasts, { ...toast, id }];
      });

      if (toast.duration) {
        setTimeout(() => {
          removeToast(id);
        }, toast.duration);
      }
    },
    [enabled, removeToast],
  );

  const setBannerError = useCallback(
    (error: CopilotKitError | null) => {
      // Respect the enabled flag for ALL errors
      if (!enabled && error !== null) {
        return;
      }
      setBannerErrorState(error);
    },
    [enabled],
  );

  const addGraphQLErrorsToast = useCallback((errors: GraphQLError[]) => {
    // DEPRECATED: All errors now route to banners for consistency
    console.warn("addGraphQLErrorsToast is deprecated. All errors now show as banners.");
    // Function kept for backward compatibility - does nothing
  }, []);

  const value = {
    toasts,
    addToast,
    addGraphQLErrorsToast,
    removeToast,
    enabled,
    bannerError,
    setBannerError,
  };

  return (
    <ToastContext.Provider value={value}>
      {/* Banner Error Display */}
      {bannerError &&
        (() => {
          const severity = getErrorSeverity(bannerError);
          const colors = getErrorColors(severity);

          return (
            <div
              style={{
                position: "fixed",
                bottom: "20px",
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 9999,
                backgroundColor: colors.background,
                border: `1px solid ${colors.border}`,
                borderLeft: `4px solid ${colors.border}`,
                borderRadius: "8px",
                padding: "12px 16px",
                fontSize: "13px",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                backdropFilter: "blur(8px)",
                maxWidth: "min(90vw, 700px)",
                width: "100%",
                boxSizing: "border-box",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      backgroundColor: colors.border,
                      flexShrink: 0,
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        color: colors.text,
                        lineHeight: "1.4",
                        fontWeight: "400",
                        fontSize: "13px",
                        flex: 1,
                        wordBreak: "break-all",
                        overflowWrap: "break-word",
                        maxWidth: "550px",
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 10,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {(() => {
                        let message = bannerError.message;

                        // Try to extract the useful message from JSON first
                        const jsonMatch = message.match(/'message':\s*'([^']+)'/);
                        if (jsonMatch) {
                          return jsonMatch[1]; // Return the actual error message
                        }

                        // Strip technical garbage but keep the meaningful message
                        message = message.split(" - ")[0]; // Remove everything after " - {"
                        message = message.split(": Error code")[0]; // Remove ": Error code: 401"
                        message = message.replace(/:\s*\d{3}$/, ""); // Remove trailing ": 401"
                        message = message.replace(/See more:.*$/g, ""); // Remove "See more" links
                        message = message.trim();

                        // If it's still garbage (contains { or '), use fallback
                        // if (message.includes("{") || message.includes("'")) {
                        //   return "Configuration error.... Please check your setup.";
                        // }

                        return message || "Configuration error occurred.";
                      })()}
                    </div>

                    {(() => {
                      const message = bannerError.message;
                      const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
                      const plainUrlRegex = /(https?:\/\/[^\s)]+)/g;

                      // Extract the first URL found
                      let url = null;
                      let buttonText = "See More";

                      // Check for markdown links first
                      const markdownMatch = markdownLinkRegex.exec(message);
                      if (markdownMatch) {
                        url = markdownMatch[2];
                        buttonText = "See More";
                      } else {
                        // Check for plain URLs
                        const urlMatch = plainUrlRegex.exec(message);
                        if (urlMatch) {
                          url = urlMatch[0].replace(/[.,;:'"]*$/, ""); // Remove trailing punctuation
                          buttonText = "See More";
                        }
                      }

                      if (!url) return null;

                      return (
                        <button
                          onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
                          style={{
                            background: colors.border,
                            color: "white",
                            border: "none",
                            borderRadius: "5px",
                            padding: "4px 10px",
                            fontSize: "11px",
                            fontWeight: "500",
                            cursor: "pointer",
                            transition: "all 0.2s ease",
                            flexShrink: 0,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = "0.9";
                            e.currentTarget.style.transform = "translateY(-1px)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = "1";
                            e.currentTarget.style.transform = "translateY(0)";
                          }}
                        >
                          {buttonText}
                        </button>
                      );
                    })()}
                  </div>
                </div>
                <button
                  onClick={() => setBannerError(null)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: colors.text,
                    cursor: "pointer",
                    padding: "2px",
                    borderRadius: "3px",
                    fontSize: "14px",
                    lineHeight: "1",
                    opacity: 0.6,
                    transition: "all 0.2s ease",
                    flexShrink: 0,
                  }}
                  title="Dismiss"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = "1";
                    e.currentTarget.style.background = "rgba(0, 0, 0, 0.05)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "0.6";
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })()}

      {/* Toast Display - Deprecated: All errors now show as banners */}
      {children}
    </ToastContext.Provider>
  );
}

// Toast component removed - all errors now show as banners for consistency

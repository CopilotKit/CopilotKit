import { GraphQLError } from "@copilotkit/runtime-client-gql";
import React, { createContext, useContext, useState, useCallback } from "react";
import { ErrorToast } from "../error-boundary/error-utils";
import { PartialBy, CopilotKitError, Severity } from "@copilotkit/shared";
import { renderCopilotKitUsage } from "../usage-banner";

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
        background: "#fef2f2",
        border: "#fca5a5",
        text: "#991b1b",
        icon: "#dc2626",
      };
    case "warning":
      return {
        background: "#fffbeb",
        border: "#fcd34d",
        text: "#92400e",
        icon: "#f59e0b",
      };
    case "info":
      return {
        background: "#eff6ff",
        border: "#93c5fd",
        text: "#1e3a8a",
        icon: "#3b82f6",
      };
  }
}

function getErrorIcon(severity: ErrorSeverity): string {
  switch (severity) {
    case "critical":
      return "🚨";
    case "warning":
      return "⚠️";
    case "info":
      return "ℹ️";
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
      // Allow structured errors to bypass the enabled check
      const isStructuredError =
        toast.type === "error" &&
        React.isValidElement(toast.message) &&
        (toast.message as any)?.props?.errors;

      if (!enabled && !isStructuredError) {
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

  const addGraphQLErrorsToast = useCallback(
    (errors: GraphQLError[]) => {
      if (errors.length === 0) {
        return;
      }

      // Check if any error has explicit visibility (structured errors should always show)
      const hasStructuredError = errors.some(
        (error) => error.extensions?.visibility && error.extensions.visibility !== "silent",
      );

      if (!enabled && !hasStructuredError) {
        return;
      }

      addToast({
        type: "error",
        message: <ErrorToast errors={errors} />,
      });
    },
    [enabled, addToast],
  );

  const setBannerError = useCallback(
    (error: CopilotKitError | null) => {
      if (!enabled && error !== null) {
        return;
      }
      setBannerErrorState(error);
    },
    [enabled],
  );

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
          const icon = getErrorIcon(severity);

          return (
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                zIndex: 9999,
                backgroundColor: colors.background,
                borderBottom: `2px solid ${colors.border}`,
                padding: "16px 20px",
                fontSize: "14px",
                boxShadow: "0 2px 12px rgba(0, 0, 0, 0.08)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  maxWidth: "1200px",
                  margin: "0 auto",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1 }}>
                  <span style={{ color: colors.icon, fontSize: "20px" }}>{icon}</span>
                  <div
                    style={{
                      color: colors.text,
                      lineHeight: "1.5",
                      fontWeight: "500",
                      fontSize: "15px",
                    }}
                  >
                    {bannerError.message}
                  </div>
                </div>
                <button
                  onClick={() => setBannerError(null)}
                  style={{
                    background: "rgba(255, 255, 255, 0.7)",
                    border: `1px solid ${colors.border}`,
                    color: colors.text,
                    cursor: "pointer",
                    padding: "6px 10px",
                    borderRadius: "8px",
                    fontSize: "14px",
                    fontWeight: "500",
                    marginLeft: "16px",
                    transition: "all 0.2s ease",
                    opacity: 0.8,
                  }}
                  title="Dismiss"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.9)";
                    e.currentTarget.style.opacity = "1";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.7)";
                    e.currentTarget.style.opacity = "0.8";
                  }}
                >
                  ✕
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

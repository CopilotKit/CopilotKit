import { useCopilotContext } from "../../context";
import { GraphQLError } from "@copilotkit/runtime-client-gql";
import React, { createContext, useContext, useState, useCallback } from "react";
import { ExclamationMarkIcon } from "./exclamation-mark-icon";

interface Toast {
  id: string;
  message: string | React.ReactNode;
  type: "info" | "success" | "warning" | "error";
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  addGraphQLErrorsToast: (errors: GraphQLError[]) => void;
  removeToast: (id: string) => void;
  enabled: boolean;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

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
  const addToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).substring(2, 9);

    setToasts((currentToasts) => [...currentToasts, { ...toast, id }]);

    if (toast.duration) {
      setTimeout(() => {
        removeToast(id);
      }, toast.duration);
    }
  }, []);

  const addGraphQLErrorsToast = useCallback((errors: GraphQLError[]) => {
    // We do not display these errors unless we are in dev mode.
    // if (!showDevConsole) {
    //   return;
    // }

    const errorsToRender = errors.map((error, idx) => {
      const message = error.message;
      const code = error.extensions?.code as string;

      return (
        <div
          key={idx}
          style={{
            marginTop: idx === 0 ? 0 : 10,
            marginBottom: 14,
          }}
        >
          <ExclamationMarkIcon style={{ marginBottom: 4 }} />

          {code && (
            <div
              style={{
                fontWeight: "600",
                marginBottom: 4,
              }}
            >
              Copilot Cloud Error:{" "}
              <span style={{ fontFamily: "monospace", fontWeight: "normal" }}>{code}</span>
            </div>
          )}
          <div>{message}</div>
        </div>
      );
    });

    addToast({
      type: "error",
      message: (
        <div
          style={{
            fontSize: "13px",
            maxWidth: "600px",
          }}
        >
          {errorsToRender}
          <div style={{ fontSize: "11px", opacity: 0.75 }}>
            NOTE: This is a Copilot Cloud error, and it only displays during local development.
          </div>
        </div>
      ),
    });
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id));
  }, []);

  const value = {
    toasts,
    addToast,
    addGraphQLErrorsToast,
    removeToast,
    enabled,
  };

  return (
    <ToastContext.Provider value={value}>
      <div
        style={{
          position: "fixed",
          bottom: "1rem",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
        }}
      >
        {toasts.length > 1 && (
          <div style={{ textAlign: "right" }}>
            <button
              onClick={() => setToasts([])}
              style={{
                padding: "4px 8px",
                fontSize: "12px",
                cursor: "pointer",
                background: "white",
                border: "1px solid rgba(0,0,0,0.2)",
                borderRadius: "4px",
              }}
            >
              Close All
            </button>
          </div>
        )}
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </div>
      {children}
    </ToastContext.Provider>
  );
}

function Toast({
  message,
  type = "info",
  onClose,
}: {
  message: string | React.ReactNode;
  type: "info" | "success" | "warning" | "error";
  onClose: () => void;
}) {
  const bgColors = {
    info: "#3b82f6",
    success: "#22c55e",
    warning: "#eab308",
    error: "#ef4444",
  };

  return (
    <div
      style={{
        backgroundColor: bgColors[type],
        color: "white",
        padding: "0.5rem 1rem",
        borderRadius: "0.25rem",
        boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
        position: "relative",
        minWidth: "200px",
      }}
    >
      <div>{message}</div>
      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: "0",
          right: "0",
          background: "none",
          border: "none",
          color: "white",
          cursor: "pointer",
          padding: "0.5rem",
          fontSize: "1rem",
        }}
      >
        ✕
      </button>
    </div>
  );
}

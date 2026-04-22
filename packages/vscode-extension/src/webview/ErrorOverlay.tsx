import React from "react";

interface ErrorOverlayProps {
  message: string;
  onDismiss: () => void;
}

export function ErrorOverlay({
  message,
  onDismiss,
}: ErrorOverlayProps): React.ReactElement {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        padding: "12px 16px",
        background: "var(--vscode-inputValidation-errorBackground, #5a1d1d)",
        borderBottom:
          "1px solid var(--vscode-inputValidation-errorBorder, #be1100)",
        color: "var(--vscode-errorForeground, #f48771)",
        fontFamily: "var(--vscode-editor-font-family, monospace)",
        fontSize: "12px",
        zIndex: 1000,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
      }}
    >
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", flex: 1 }}>
        {message}
      </pre>
      <button
        onClick={onDismiss}
        style={{
          background: "none",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          padding: "0 4px",
          fontSize: "16px",
          lineHeight: 1,
          marginLeft: "12px",
        }}
        title="Dismiss"
      >
        x
      </button>
    </div>
  );
}

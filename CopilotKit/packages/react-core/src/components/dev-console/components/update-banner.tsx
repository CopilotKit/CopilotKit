interface UpdateBannerProps {
  latestVersion: string;
  onDismiss: () => void;
}

export function UpdateBanner({ latestVersion, onDismiss }: UpdateBannerProps) {
  return (
    <div
      style={{
        backgroundColor: "#fef3c7",
        borderBottom: "1px solid #fbbf24",
        padding: "12px 20px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        fontSize: "13px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ color: "#92400e", fontWeight: "500" }}>
          ⚠️ Update available: v{latestVersion}
        </span>
        <button
          onClick={onDismiss}
          style={{
            background: "none",
            border: "none",
            color: "#92400e",
            cursor: "pointer",
            padding: "0 4px",
            fontSize: "18px",
            lineHeight: "1",
          }}
          title="Dismiss"
        >
          ×
        </button>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <code
          style={{
            flex: 1,
            backgroundColor: "#fffbeb",
            border: "1px solid #fbbf24",
            borderRadius: "4px",
            padding: "6px 10px",
            fontSize: "12px",
            fontFamily: "monospace",
            color: "#92400e",
          }}
        >
          pnpm add @copilotkit/react-core@latest
        </code>
        <button
          onClick={() => {
            navigator.clipboard.writeText("pnpm add @copilotkit/react-core@latest");
          }}
          style={{
            backgroundColor: "#fbbf24",
            border: "none",
            borderRadius: "4px",
            padding: "6px 12px",
            fontSize: "12px",
            fontWeight: "500",
            color: "#92400e",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
          title="Copy to clipboard"
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f59e0b")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#fbbf24")}
        >
          Copy
        </button>
      </div>
    </div>
  );
}

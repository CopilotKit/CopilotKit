import { Severity, CopilotKitError, ERROR_NAMES } from "@copilotkit/shared";

interface UsageBannerProps {
  severity?: Severity;
  message?: string;
  icon?: React.ReactNode;
  actions?: {
    primary?: {
      label: string;
      onClick: () => void;
    };
    secondary?: {
      label: string;
      onClick: () => void;
    };
  };
}

const defaultIcons: Record<Severity, JSX.Element> = {
  [Severity.Error]: (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
};

export function UsageBanner({
  severity = Severity.Error,
  message = "",
  icon,
  actions,
}: UsageBannerProps) {
  if (!message || !severity) {
    return null;
  }

  const Icon = icon || defaultIcons[severity];

  const bgColor = {
    info: "#dbeafe",
    warning: "#fef3c7",
    error: "#fee2e2",
  }[severity];

  const textColor = {
    info: "#1e40af",
    warning: "#854d0e",
    error: "#991b1b",
  }[severity];

  const iconColor = {
    info: "#3b82f6",
    warning: "#eab308",
    error: "#ef4444",
  }[severity];

  const primaryButtonColor = {
    info: "#3b82f6",
    warning: "#eab308",
    error: "#ef4444",
  }[severity];

  const primaryButtonHoverColor = {
    info: "#2563eb",
    warning: "#ca8a04",
    error: "#dc2626",
  }[severity];

  return (
    <div
      style={{
        position: "fixed",
        bottom: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: "90%",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "12px",
          borderRadius: "9999px",
          border: "1px solid #e5e7eb",
          backgroundColor: bgColor,
          padding: "8px 16px",
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
        }}
      >
        <div style={{ color: iconColor }}>{Icon}</div>
        <span
          style={{
            flex: 1,
            fontSize: "14px",
            fontWeight: 500,
            color: textColor,
            whiteSpace: "normal",
            wordBreak: "break-word",
          }}
        >
          {message}
        </span>
        <div
          style={{
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          {actions?.secondary && (
            <button
              onClick={actions.secondary.onClick}
              style={{
                borderRadius: "9999px",
                padding: "4px 12px",
                fontSize: "14px",
                fontWeight: 500,
                color: textColor,
                backgroundColor: "transparent",
                border: "none",
                cursor: "pointer",
                transition: "background-color 0.2s",
              }}
              onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.5)")}
              onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              {actions.secondary.label}
            </button>
          )}
          {actions?.primary && (
            <button
              onClick={actions.primary.onClick}
              style={{
                borderRadius: "9999px",
                padding: "4px 12px",
                fontSize: "14px",
                fontWeight: 500,
                color: "#fff",
                backgroundColor: primaryButtonColor,
                border: "none",
                cursor: "pointer",
                transition: "background-color 0.2s",
              }}
              onMouseOver={(e) => (e.currentTarget.style.backgroundColor = primaryButtonHoverColor)}
              onMouseOut={(e) => (e.currentTarget.style.backgroundColor = primaryButtonColor)}
            >
              {actions.primary.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function renderCopilotKitUsage(error: CopilotKitError) {
  switch (error.name) {
    case ERROR_NAMES.CONFIGURATION_ERROR:
      return <UsageBanner severity={error.severity} message={error.message} />;
    case ERROR_NAMES.MISSING_PUBLIC_API_KEY_ERROR:
      return (
        <UsageBanner
          severity={error.severity}
          message={error.message}
          actions={{
            primary: {
              label: "Sign In",
              onClick: () => {
                window.location.href = "https://cloud.copilotkit.ai";
              },
            },
          }}
        />
      );
    case ERROR_NAMES.UPGRADE_REQUIRED_ERROR:
      return (
        <UsageBanner
          severity={error.severity}
          message={error.message}
          actions={{
            primary: {
              label: "Upgrade",
              onClick: () => {
                window.location.href = "https://copilotkit.ai/";
              },
            },
          }}
        />
      );
  }
}

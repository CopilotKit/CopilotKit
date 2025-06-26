import { Severity, CopilotKitError, ERROR_NAMES, ErrorVisibility } from "@copilotkit/shared";

interface UsageBannerProps {
  severity?: Severity;
  message?: string;
  icon?: React.ReactNode;
  onClose?: () => void;
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
  [Severity.CRITICAL]: (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      stroke="currentColor"
      strokeWidth="2.5"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  [Severity.WARNING]: (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      stroke="currentColor"
      strokeWidth="2.5"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  [Severity.INFO]: (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      stroke="currentColor"
      strokeWidth="2.5"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
};

export function UsageBanner({
  severity = Severity.CRITICAL,
  message = "",
  icon,
  onClose,
  actions,
}: UsageBannerProps) {
  if (!message || !severity) {
    return null;
  }

  // Enhanced message parsing to clean up technical details
  const parseMessage = (rawMessage: string) => {
    // console.log("Raw message:", rawMessage); // Debug

    // Super aggressive cleaning - handle common error patterns first
    if (
      rawMessage.toLowerCase().includes("authentication") ||
      rawMessage.toLowerCase().includes("api key")
    ) {
      return "Authentication failed. Please check your API key.";
    }

    if (rawMessage.toLowerCase().includes("rate limit")) {
      return "Rate limit exceeded. Please try again later.";
    }

    if (rawMessage.toLowerCase().includes("checkpointer")) {
      return "Agent configuration error. Please check your setup.";
    }

    // For any other error, extract just the main error type
    let cleanMessage = rawMessage;

    // Remove everything after the first " - " or ":" followed by technical details
    cleanMessage = cleanMessage.split(" - ")[0];
    cleanMessage = cleanMessage.split(": Error code")[0];
    cleanMessage = cleanMessage.split(": 401")[0];
    cleanMessage = cleanMessage.split(": 403")[0];
    cleanMessage = cleanMessage.split(": 404")[0];
    cleanMessage = cleanMessage.split(": 500")[0];

    // Remove "See more" links
    cleanMessage = cleanMessage.replace(/See more:.*$/g, "").trim();

    // If still too technical, just show a generic message
    if (cleanMessage.includes("{") || cleanMessage.includes("'") || cleanMessage.length > 60) {
      return "Configuration error. Please check your setup.";
    }

    return cleanMessage || "An error occurred. Please check your configuration.";
  };

  const cleanMessage = parseMessage(message);
  const Icon = icon || defaultIcons[severity];

  const themeConfigs = {
    [Severity.INFO]: {
      bg: "rgba(239, 246, 255, 0.95)",
      border: "#93c5fd",
      text: "#1e40af",
      icon: "#3b82f6",
      primaryBtn: "#3b82f6",
      primaryBtnHover: "#2563eb",
    },
    [Severity.WARNING]: {
      bg: "rgba(255, 251, 235, 0.95)",
      border: "#fbbf24",
      text: "#92400e",
      icon: "#f59e0b",
      primaryBtn: "#f59e0b",
      primaryBtnHover: "#d97706",
    },
    [Severity.CRITICAL]: {
      bg: "rgba(254, 242, 242, 0.95)",
      border: "#f87171",
      text: "#991b1b",
      icon: "#ef4444",
      primaryBtn: "#ef4444",
      primaryBtnHover: "#dc2626",
    },
  };

  const themeConfig = themeConfigs[severity] || themeConfigs[Severity.CRITICAL];

  return (
    <div
      style={{
        position: "fixed",
        bottom: "24px",
        left: "50%",
        transform: "translateX(-50%)",
        width: "400px",
        maxWidth: "90vw",
        zIndex: 10000,
        animation: "bannerSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <style>
        {`
          @keyframes bannerSlideIn {
            from {
              opacity: 0;
              transform: translateX(-50%) translateY(20px);
              scale: 0.95;
            }
            to {
              opacity: 1;
              transform: translateX(-50%) translateY(0);
              scale: 1;
            }
          }
        `}
      </style>
      <div
        style={{
          borderRadius: "12px",
          border: `1px solid ${themeConfig.border}`,
          background: themeConfig.bg,
          padding: "14px",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08)",
          position: "relative",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            style={{
              position: "absolute",
              top: "8px",
              right: "8px",
              background: "rgba(255, 255, 255, 0.9)",
              border: "none",
              color: themeConfig.text,
              cursor: "pointer",
              fontSize: "16px",
              lineHeight: "1",
              padding: "4px",
              borderRadius: "4px",
              width: "20px",
              height: "20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Close"
          >
            ×
          </button>
        )}

        {/* Message */}
        <div
          style={{
            fontSize: "14px",
            fontWeight: 500,
            color: themeConfig.text,
            lineHeight: "1.4",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            paddingRight: onClose ? "30px" : "0",
            marginBottom: actions ? "12px" : "0",
            wordBreak: "break-word",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {cleanMessage}
        </div>

        {/* Actions */}
        {actions && (
          <div
            style={{
              display: "flex",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            {actions.secondary && (
              <button
                onClick={actions.secondary.onClick}
                style={{
                  borderRadius: "8px",
                  padding: "6px 12px",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: themeConfig.text,
                  backgroundColor: "rgba(255, 255, 255, 0.9)",
                  border: `1px solid ${themeConfig.border}`,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 1)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.9)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {actions.secondary.label}
              </button>
            )}
            {actions.primary && (
              <button
                onClick={actions.primary.onClick}
                style={{
                  borderRadius: "8px",
                  padding: "6px 12px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#fff",
                  backgroundColor: themeConfig.primaryBtn,
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = themeConfig.primaryBtnHover;
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.2)";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = themeConfig.primaryBtn;
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.15)";
                }}
              >
                {actions.primary.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function renderCopilotKitUsage(error: CopilotKitError, onClose?: () => void) {
  // Route based on error visibility level
  if (error.visibility !== ErrorVisibility.BANNER) {
    return null;
  }

  // Extract URL from markdown links in the message
  const extractUrlFromMessage = (message: string): string | null => {
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const match = linkRegex.exec(message);
    return match ? match[2] : null;
  };

  // Get action button based on error type
  const getErrorActions = (error: CopilotKitError) => {
    switch (error.name) {
      case ERROR_NAMES.MISSING_PUBLIC_API_KEY_ERROR:
        return {
          primary: {
            label: "Sign In",
            onClick: () => (window.location.href = "https://cloud.copilotkit.ai"),
          },
        };
      case ERROR_NAMES.UPGRADE_REQUIRED_ERROR:
        return {
          primary: {
            label: "Upgrade",
            onClick: () => (window.location.href = "https://copilotkit.ai/"),
          },
        };
      case ERROR_NAMES.COPILOT_API_DISCOVERY_ERROR:
      case ERROR_NAMES.COPILOT_REMOTE_ENDPOINT_DISCOVERY_ERROR:
      case ERROR_NAMES.COPILOT_KIT_AGENT_DISCOVERY_ERROR:
        return {
          primary: {
            label: "View Docs",
            onClick: () => {
              // Try to get URL from the error message first, then extensions, then default
              const urlFromMessage = extractUrlFromMessage(error.message);
              const urlFromExtensions = (error.extensions as any)?.troubleshootingUrl;
              const url =
                urlFromMessage ||
                urlFromExtensions ||
                "https://docs.copilotkit.ai/troubleshooting/common-issues";
              window.open(url, "_blank");
            },
          },
        };
      default:
        return undefined;
    }
  };

  return (
    <UsageBanner
      severity={error.severity || Severity.CRITICAL}
      message={error.message}
      onClose={onClose}
      actions={getErrorActions(error)}
    />
  );
}

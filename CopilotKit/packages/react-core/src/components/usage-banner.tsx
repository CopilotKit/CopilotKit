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
  [Severity.Error]: (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
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
};

export function UsageBanner({
  severity = Severity.Error,
  message = "",
  icon,
  onClose,
  actions,
}: UsageBannerProps) {
  if (!message || !severity) {
    return null;
  }

  // Parse markdown links from message and clean it up
  const parseMessage = (rawMessage: string) => {
    // Extract markdown links: [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const matches = Array.from(rawMessage.matchAll(linkRegex));

    if (matches.length > 0) {
      // Remove "See more:" and markdown links from the main message
      let cleanMessage = rawMessage
        .replace(/\.\s*See more:\s*\[([^\]]+)\]\(([^)]+)\)/g, ".")
        .replace(/See more:\s*\[([^\]]+)\]\(([^)]+)\)/g, "")
        .trim();

      return cleanMessage;
    }

    return rawMessage;
  };

  const cleanMessage = parseMessage(message);
  const Icon = icon || defaultIcons[severity];

  const themeConfig = {
    info: {
      bg: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
      border: "#93c5fd",
      text: "#1e40af",
      icon: "#3b82f6",
      primaryBtn: "#3b82f6",
      primaryBtnHover: "#2563eb",
    },
    warning: {
      bg: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
      border: "#fbbf24",
      text: "#92400e",
      icon: "#f59e0b",
      primaryBtn: "#f59e0b",
      primaryBtnHover: "#d97706",
    },
    error: {
      bg: "linear-gradient(135deg, #fef2f2 0%, #fecaca 100%)",
      border: "#f87171",
      text: "#991b1b",
      icon: "#ef4444",
      primaryBtn: "#ef4444",
      primaryBtnHover: "#dc2626",
    },
  }[severity];

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: "min(95vw, 680px)",
        width: "100%",
        zIndex: 10000,
        animation: "bannerSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <style>
        {`
          @keyframes bannerSlideIn {
            from {
              opacity: 0;
              transform: translateX(-50%) translateY(10px);
            }
            to {
              opacity: 1;
              transform: translateX(-50%) translateY(0);
            }
          }
        `}
      </style>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "14px",
          borderRadius: "16px",
          border: `1px solid ${themeConfig.border}`,
          background: themeConfig.bg,
          padding: "18px 20px",
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
          position: "relative",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
        }}
      >
        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            style={{
              position: "absolute",
              top: "12px",
              right: "12px",
              background: "rgba(255, 255, 255, 0.8)",
              border: "none",
              color: themeConfig.text,
              cursor: "pointer",
              fontSize: "18px",
              lineHeight: "1",
              padding: "6px",
              borderRadius: "8px",
              opacity: 0.7,
              transition: "all 0.2s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "28px",
              height: "28px",
            }}
            title="Close"
            onMouseOver={(e) => {
              e.currentTarget.style.opacity = "1";
              e.currentTarget.style.background = "rgba(255, 255, 255, 1)";
              e.currentTarget.style.transform = "scale(1.05)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.opacity = "0.7";
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.8)";
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            ×
          </button>
        )}

        {/* Icon */}
        <div
          style={{
            color: themeConfig.icon,
            flexShrink: 0,
            marginTop: "1px",
            padding: "6px",
            borderRadius: "10px",
            background: "rgba(255, 255, 255, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {Icon}
        </div>

        {/* Content */}
        <div style={{ flex: 1, paddingRight: onClose ? "40px" : "0" }}>
          {/* Message */}
          <div
            style={{
              fontSize: "15px",
              fontWeight: 600,
              color: themeConfig.text,
              lineHeight: "1.5",
              marginBottom: actions ? "12px" : "0",
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            }}
          >
            {cleanMessage}
          </div>

          {/* Actions */}
          {actions && (
            <div
              style={{
                display: "flex",
                gap: "10px",
                flexWrap: "wrap",
              }}
            >
              {actions.secondary && (
                <button
                  onClick={actions.secondary.onClick}
                  style={{
                    borderRadius: "10px",
                    padding: "8px 16px",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: themeConfig.text,
                    backgroundColor: "rgba(255, 255, 255, 0.8)",
                    border: `1.5px solid ${themeConfig.border}`,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 1)";
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.15)";
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.8)";
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  {actions.secondary.label}
                </button>
              )}
              {actions.primary && (
                <button
                  onClick={actions.primary.onClick}
                  style={{
                    borderRadius: "10px",
                    padding: "8px 16px",
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#fff",
                    backgroundColor: themeConfig.primaryBtn,
                    border: "none",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = themeConfig.primaryBtnHover;
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.boxShadow = "0 6px 16px rgba(0, 0, 0, 0.2)";
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = themeConfig.primaryBtn;
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.15)";
                  }}
                >
                  {actions.primary.label}
                </button>
              )}
            </div>
          )}
        </div>
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
      severity={error.severity || Severity.Error}
      message={error.message}
      onClose={onClose}
      actions={getErrorActions(error)}
    />
  );
}

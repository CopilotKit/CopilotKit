import {
  Severity,
  CopilotKitError,
  ErrorVisibility,
  CopilotKitErrorCode,
} from "@copilotkit/shared";
import React from "react";

interface UsageBannerProps {
  severity?: Severity;
  message?: string | React.ReactNode;
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

export function UsageBanner({
  severity = Severity.CRITICAL,
  message = "",
  onClose,
  actions,
}: UsageBannerProps) {
  if (!message || !severity) {
    return null;
  }

  const themes = {
    [Severity.INFO]: {
      bg: "#f8fafc",
      border: "#e2e8f0",
      text: "#475569",
      accent: "#3b82f6",
    },
    [Severity.WARNING]: {
      bg: "#fffbeb",
      border: "#fbbf24",
      text: "#92400e",
      accent: "#f59e0b",
    },
    [Severity.CRITICAL]: {
      bg: "#fef2f2",
      border: "#fecaca",
      text: "#dc2626",
      accent: "#ef4444",
    },
  };

  const theme = themes[severity];

  return (
    <>
      <style>
        {`
          @keyframes slideUp {
            from { opacity: 0; transform: translateX(-50%) translateY(8px); }
            to { opacity: 1; transform: translateX(-50%) translateY(0); }
          }
          
          .usage-banner {
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            width: min(600px, calc(100vw - 32px));
            z-index: 10000;
            animation: slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          }
          
          .banner-content {
            background: linear-gradient(135deg, ${theme.bg} 0%, ${theme.bg}f5 100%);
            border: 1px solid ${theme.border};
            border-radius: 12px;
            padding: 18px 20px;
            box-shadow: 
              0 4px 24px rgba(0, 0, 0, 0.08),
              0 2px 8px rgba(0, 0, 0, 0.04),
              inset 0 1px 0 rgba(255, 255, 255, 0.7);
            display: flex;
            align-items: center;
            gap: 16px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            backdrop-filter: blur(12px);
            position: relative;
            overflow: hidden;
          }
          
          .banner-content::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 1px;
            background: linear-gradient(90deg, transparent, ${theme.accent}40, transparent);
          }
          
          .banner-message {
            color: ${theme.text};
            font-size: 14px;
            line-height: 1.5;
            font-weight: 500;
            flex: 1;
            letter-spacing: -0.01em;
          }
          
          .close-btn {
            background: rgba(0, 0, 0, 0.05);
            border: none;
            color: ${theme.text};
            cursor: pointer;
            padding: 0;
            border-radius: 6px;
            opacity: 0.6;
            transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
            font-size: 14px;
            line-height: 1;
            flex-shrink: 0;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          
          .close-btn:hover {
            opacity: 1;
            background: rgba(0, 0, 0, 0.08);
            transform: scale(1.05);
          }
          
          .btn-primary {
            background: linear-gradient(135deg, ${theme.accent} 0%, ${theme.accent}e6 100%);
            color: white;
            border: none;
            border-radius: 8px;
            padding: 10px 18px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
            font-family: inherit;
            flex-shrink: 0;
            box-shadow: 
              0 2px 8px ${theme.accent}30,
              inset 0 1px 0 rgba(255, 255, 255, 0.2);
            letter-spacing: -0.01em;
          }
          
          .btn-primary:hover {
            transform: translateY(-1px) scale(1.02);
            box-shadow: 
              0 4px 12px ${theme.accent}40,
              inset 0 1px 0 rgba(255, 255, 255, 0.25);
          }
          
          .btn-primary:active {
            transform: translateY(0) scale(0.98);
            transition: all 0.08s cubic-bezier(0.16, 1, 0.3, 1);
          }
          
          @media (max-width: 640px) {
            .usage-banner {
              width: calc(100vw - 24px);
            }
            
            .banner-content {
              padding: 16px;
              gap: 12px;
            }
            
            .banner-message {
              font-size: 13px;
              line-height: 1.45;
            }
            
            .btn-primary {
              padding: 8px 14px;
              font-size: 12px;
            }
            
            .close-btn {
              width: 22px;
              height: 22px;
              font-size: 12px;
            }
          }
        `}
      </style>

      <div className="usage-banner">
        <div className="banner-content">
          <div className="banner-message">{message}</div>
          {actions?.primary && (
            <button className="btn-primary" onClick={actions.primary.onClick}>
              {actions.primary.label}
            </button>
          )}
          {onClose && (
            <button className="close-btn" onClick={onClose} title="Close">
              ×
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// Get action button based on error type
export const getErrorActions = (error: CopilotKitError) => {
  switch (error.code) {
    case CopilotKitErrorCode.MISSING_PUBLIC_API_KEY_ERROR:
      return {
        primary: {
          label: "Show me how",
          onClick: () =>
            window.open(
              "https://docs.copilotkit.ai/premium#how-do-i-get-access-to-premium-features",
              "_blank",
              "noopener,noreferrer",
            ),
        },
      };
    case CopilotKitErrorCode.UPGRADE_REQUIRED_ERROR:
      return {
        primary: {
          label: "Upgrade",
          onClick: () =>
            window.open("https://cloud.copilotkit.ai", "_blank", "noopener,noreferrer"),
        },
      };
    default:
      return undefined;
  }
};

export function renderCopilotKitUsage(error: CopilotKitError, onClose?: () => void) {
  // Route based on error visibility level
  if (error.visibility !== ErrorVisibility.BANNER) {
    return null;
  }

  return (
    <UsageBanner
      severity={error.severity || Severity.CRITICAL}
      message={error.message}
      onClose={onClose}
      actions={getErrorActions(error)}
    />
  );
}

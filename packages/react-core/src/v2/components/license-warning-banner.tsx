import React, { useEffect } from "react";

// Total reserved vertical space for the fixed license banner: banner height
// (~36px) + bottom offset (8px) + visual gap above the chat input (~8px).
const LICENSE_BANNER_OFFSET_PX = 52;
const LICENSE_BANNER_OFFSET_VAR = "--copilotkit-license-banner-offset";

interface LicenseWarningBannerProps {
  type:
    | "no_license"
    | "expired"
    | "expiring"
    | "invalid"
    | "feature_unlicensed";
  featureName?: string;
  expiryDate?: string;
  graceRemaining?: number;
  onDismiss?: () => void;
}

const BANNER_STYLES: Record<string, React.CSSProperties> = {
  base: {
    position: "fixed",
    bottom: "8px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 99999,
    display: "inline-flex",
    alignItems: "center",
    gap: "12px",
    whiteSpace: "nowrap",
    padding: "8px 16px",
    fontSize: "13px",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    borderRadius: "6px",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
  },
  info: {
    backgroundColor: "#eff6ff",
    border: "1px solid #93c5fd",
    color: "#1e40af",
  },
  warning: {
    backgroundColor: "#fffbeb",
    border: "1px solid #fbbf24",
    color: "#92400e",
  },
  critical: {
    backgroundColor: "#fef2f2",
    border: "1px solid #fca5a5",
    color: "#991b1b",
  },
};

function getSeverityStyle(severity: string): React.CSSProperties {
  switch (severity) {
    case "warning":
      return BANNER_STYLES.warning;
    case "critical":
      return BANNER_STYLES.critical;
    default:
      return BANNER_STYLES.info;
  }
}

function BannerShell({
  severity,
  message,
  actionLabel,
  actionUrl,
  onDismiss,
}: {
  severity: string;
  message: string;
  actionLabel: string;
  actionUrl: string;
  onDismiss?: () => void;
}) {
  // Publish the banner's reserved bottom offset so the chat input can lift
  // itself above it via padding-bottom: var(--copilotkit-license-banner-offset).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.style.setProperty(
      LICENSE_BANNER_OFFSET_VAR,
      `${LICENSE_BANNER_OFFSET_PX}px`,
    );
    return () => {
      root.style.removeProperty(LICENSE_BANNER_OFFSET_VAR);
    };
  }, []);

  return (
    <div style={{ ...BANNER_STYLES.base, ...getSeverityStyle(severity) }}>
      <span>{message}</span>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <a
          href={actionUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontWeight: 600,
            textDecoration: "underline",
            color: "inherit",
          }}
        >
          {actionLabel}
        </a>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "inherit",
              fontSize: "16px",
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

export function LicenseWarningBanner({
  type,
  featureName,
  expiryDate,
  graceRemaining,
  onDismiss,
}: LicenseWarningBannerProps) {
  switch (type) {
    case "no_license":
      return (
        <BannerShell
          severity="info"
          message="Powered by CopilotKit"
          actionLabel="Get a license"
          actionUrl="https://copilotkit.ai/pricing"
          onDismiss={onDismiss}
        />
      );
    case "feature_unlicensed":
      return (
        <BannerShell
          severity="warning"
          message={`⚠ The "${featureName}" feature requires a CopilotKit license.`}
          actionLabel="Get a license"
          actionUrl="https://copilotkit.ai/pricing"
          onDismiss={onDismiss}
        />
      );
    case "expiring":
      return (
        <BannerShell
          severity="warning"
          message={`Your CopilotKit license expires in ${graceRemaining} day${graceRemaining !== 1 ? "s" : ""}. Please renew.`}
          actionLabel="Renew"
          actionUrl="https://cloud.copilotkit.ai"
          onDismiss={onDismiss}
        />
      );
    case "expired":
      return (
        <BannerShell
          severity="critical"
          message={`Your CopilotKit license expired${expiryDate ? ` on ${expiryDate}` : ""}. Please renew at copilotkit.ai/pricing`}
          actionLabel="Renew now"
          actionUrl="https://copilotkit.ai/pricing"
          onDismiss={onDismiss}
        />
      );
    case "invalid":
      return (
        <BannerShell
          severity="critical"
          message="Invalid CopilotKit license token. Please check your configuration."
          actionLabel="Get a license"
          actionUrl="https://copilotkit.ai/pricing"
          onDismiss={onDismiss}
        />
      );
    default:
      return null;
  }
}

export function InlineFeatureWarning({ featureName }: { featureName: string }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        backgroundColor: "#fffbeb",
        border: "1px solid #fbbf24",
        borderRadius: "6px",
        fontSize: "13px",
        color: "#92400e",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
      }}
    >
      ⚠ The &quot;{featureName}&quot; feature requires a CopilotKit license.{" "}
      <a
        href="https://copilotkit.ai/pricing"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "#b45309", textDecoration: "underline" }}
      >
        Get one at copilotkit.ai/pricing
      </a>
    </div>
  );
}

import { useEffect } from "react";
import {
  CopilotChatDefaultLabels,
  ɵINLINE_FEATURE_WARNING_STYLE,
  ɵLICENSE_BANNER_STYLE,
  ɵgetInlineFeatureWarningSpec,
  ɵgetLicenseBannerSpec,
  ɵreserveLicenseBannerOffset,
} from "@copilotkit/core";
import type {
  ɵLicenseBannerDetails,
  ɵLicenseBannerType,
} from "@copilotkit/core";
import { useCopilotChatConfiguration } from "../providers/CopilotChatConfigurationProvider";

/** The chat labels in effect, or the default ones outside a chat. */
function useLabels() {
  return useCopilotChatConfiguration()?.labels ?? CopilotChatDefaultLabels;
}

interface LicenseWarningBannerProps extends ɵLicenseBannerDetails {
  type: ɵLicenseBannerType;
  onDismiss?: () => void;
}

/**
 * The fixed license banner. Core's `ɵgetLicenseBannerSpec` picks its text,
 * link, and severity; this component renders them.
 */
export function LicenseWarningBanner({
  type,
  onDismiss,
  ...details
}: LicenseWarningBannerProps) {
  const spec = ɵgetLicenseBannerSpec(type, useLabels(), details);

  // Publish the banner's reserved bottom offset so the chat input can lift
  // itself above it via padding-bottom: var(--copilotkit-license-banner-offset).
  useEffect(() => ɵreserveLicenseBannerOffset(), []);

  return (
    <div
      style={{
        ...ɵLICENSE_BANNER_STYLE.base,
        ...ɵLICENSE_BANNER_STYLE.severity[spec.severity],
      }}
    >
      <span>{spec.message}</span>
      <div style={ɵLICENSE_BANNER_STYLE.actions}>
        <a
          href={spec.actionUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={ɵLICENSE_BANNER_STYLE.link}
        >
          {spec.actionLabel}
        </a>
        {onDismiss && (
          <button onClick={onDismiss} style={ɵLICENSE_BANNER_STYLE.dismiss}>
            ×
          </button>
        )}
      </div>
    </div>
  );
}

export function InlineFeatureWarning({ featureName }: { featureName: string }) {
  const spec = ɵgetInlineFeatureWarningSpec(featureName, useLabels());
  return (
    <div style={ɵINLINE_FEATURE_WARNING_STYLE.container}>
      {spec.message}{" "}
      <a
        href={spec.actionUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={ɵINLINE_FEATURE_WARNING_STYLE.link}
      >
        {spec.actionLabel}
      </a>
    </div>
  );
}

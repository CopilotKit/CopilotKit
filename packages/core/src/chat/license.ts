import { createLicenseContextValue } from "@copilotkit/shared";
import { ɵformatLabel } from "./labels";
import type { CopilotChatLabels } from "./labels";
import { CopilotKitCoreRuntimeConnectionStatus } from "../core/core";
import type { ɵRuntimeInfo } from "../core/runtime-info";
import type {
  LicenseContextValue,
  RuntimeEntitlementResponse,
  RuntimeLicenseStatus,
} from "@copilotkit/shared";

/** Input for {@link ɵresolveLicenseState}. */
export interface LicenseStateInput {
  /**
   * The legacy license status the runtime reported through `/info`
   * (`core.licenseStatus`). Leave it out until the first `/info` response.
   */
  status?: RuntimeLicenseStatus;
  /**
   * The structured entitlement response the runtime reported through `/info`
   * (`core.runtimeEntitlements`).
   */
  entitlements?: RuntimeEntitlementResponse;
  /**
   * Whether core is still retrying a retryable entitlement failure
   * (`core.runtimeEntitlementRetryPending`).
   */
  retryPending: boolean;
  /** The public API key or public license key given to the provider. */
  publicKey?: string;
}

/**
 * Resolves the license context and the license banner from the runtime
 * license authority. React, Vue, and Angular call it with the values core
 * reports, then show the banner and provide the context.
 *
 * Rules:
 *
 * - A retryable entitlement failure that core is still retrying hides the
 *   status, so no banner shows until the retry ends. A `valid` or `expiring`
 *   legacy status stays in use during the retry.
 * - A terminal entitlement failure (not retryable, no `valid` or `expiring`
 *   legacy status) keeps the reported status, but `checkFeature` returns
 *   `false` and `getLimit` returns `null` for every feature.
 * - The `no_license` banner shows only when the status is `none` and no
 *   public key is set.
 *
 * The banner text has no day count. No data source gives the days left.
 *
 * @param input - The runtime license values and the public key. See
 *   {@link LicenseStateInput}.
 * @returns `context` for the license context, `warningStatus` (the status the
 *   banner is based on, `undefined` while a retry runs), and `bannerType`
 *   (`null` when no banner shows).
 *
 * @example
 * ```ts
 * const { context, bannerType } = ɵresolveLicenseState({
 *   status: core.licenseStatus,
 *   entitlements: core.runtimeEntitlements,
 *   retryPending: core.runtimeEntitlementRetryPending,
 *   publicKey,
 * });
 * ```
 */
export function ɵresolveLicenseState({
  status,
  entitlements,
  retryPending,
  publicKey,
}: LicenseStateInput) {
  const isRetryableFailure =
    entitlements?.status !== "ready" && entitlements?.error.retryable === true;
  const isNonReady =
    entitlements !== undefined && entitlements.status !== "ready";
  const hasLegacyFallback = status === "valid" || status === "expiring";
  const isRetrying = isRetryableFailure && retryPending && !hasLegacyFallback;
  // Only a terminal failure denies features. A retryable failure (a timeout,
  // a network error, a 5xx) says nothing about what the project may use.
  const isTerminalFailure =
    isNonReady && !isRetryableFailure && !hasLegacyFallback;

  const runtimeContext = createLicenseContextValue(
    isRetrying ? undefined : status,
    entitlements,
  );
  const context: LicenseContextValue = isTerminalFailure
    ? { ...runtimeContext, checkFeature: () => false, getLimit: () => null }
    : runtimeContext;
  const warningStatus = isRetrying ? undefined : (context.status ?? undefined);

  return {
    context,
    warningStatus,
    bannerType: resolveLicenseBannerType(warningStatus, publicKey),
  };
}

function resolveLicenseBannerType(
  warningStatus: RuntimeLicenseStatus | undefined,
  publicKey: string | undefined,
) {
  switch (warningStatus) {
    case "none":
      return publicKey ? null : ("no_license" as const);
    case "expired":
    case "invalid":
    case "expiring":
      return warningStatus;
    case "valid":
    case "unknown":
    case undefined:
      return null;
  }
}

/**
 * The runtime info fields {@link ɵresolveThreadsLicense} reads. Pass core's
 * `ɵruntimeInfo` snapshot.
 */
export type ɵThreadsLicenseRuntime = Pick<
  ɵRuntimeInfo,
  "status" | "licenseStatus" | "runtimeEntitlements"
>;

/**
 * Resolves whether the threads drawer can load its thread list.
 *
 * - `licensed` is `true` when the status is `unknown` (an entitlement lookup
 *   that did not recover, so the threads endpoint decides), or when the
 *   status is `valid` or `expiring` and `checkFeature("threads")` is `true`.
 * - `licensePending` is `true` while the status is `null` (the runtime has
 *   not reported yet). Show the loading state then, not the locked view.
 * - A connected runtime that reports no license status and no entitlements
 *   (a runtime without Intelligence) never will, so its `null` status is
 *   not pending: it counts as `unknown` and the threads endpoint decides.
 *
 * @param context - The license context from {@link ɵresolveLicenseState}.
 * @param runtime - Core's runtime info snapshot (`core.ɵruntimeInfo`), or
 *   `undefined` when there is no core.
 *
 * @example
 * ```ts
 * const { licensed, licensePending } = ɵresolveThreadsLicense(
 *   context,
 *   core.ɵruntimeInfo,
 * );
 * ```
 */
export function ɵresolveThreadsLicense(
  context: LicenseContextValue,
  runtime: ɵThreadsLicenseRuntime | undefined,
) {
  const { status } = context;
  const isLicensePresent = status === "valid" || status === "expiring";
  // Read from the same runtime snapshot, so a license status that the
  // context has not caught up with yet still counts as reported.
  const hasNoLicenseAuthority =
    runtime?.status === CopilotKitCoreRuntimeConnectionStatus.Connected &&
    runtime.licenseStatus === undefined &&
    runtime.runtimeEntitlements === undefined;
  const isUnresolved =
    status === "unknown" || (status === null && hasNoLicenseAuthority);

  return {
    licensed:
      isUnresolved || (isLicensePresent && context.checkFeature("threads")),
    licensePending: status === null && !hasNoLicenseAuthority,
  };
}

/** The license banners the framework packages can show. */
export type ɵLicenseBannerType =
  | "no_license"
  | "expired"
  | "expiring"
  | "invalid"
  | "feature_unlicensed";

/** How serious a license banner is; picks its colours. */
export type ɵLicenseBannerSeverity = "info" | "warning" | "critical";

/** Details some banner types show. */
export interface ɵLicenseBannerDetails {
  /** The unlicensed feature, for `feature_unlicensed`. */
  featureName?: string;
  /** The expiry date as text, for `expired`. */
  expiryDate?: string;
  /** Days left, for `expiring`. Without it the text says "soon". */
  graceRemaining?: number;
}

const PRICING_URL = "https://copilotkit.ai/pricing";
const DASHBOARD_URL = "https://dashboard.operations.copilotkit.ai";

/**
 * What one license banner shows: its severity, text, and link. React, Vue,
 * and Angular render it with {@link ɵLICENSE_BANNER_STYLE}.
 *
 * @param type - The banner type, for example from
 *   {@link ɵresolveLicenseState}'s `bannerType`.
 * @param labels - The chat labels in effect, so apps can translate the text.
 * @param details - The feature name, expiry date, or days left.
 *
 * @example
 * ```ts
 * const spec = ɵgetLicenseBannerSpec("expiring", labels, { graceRemaining: 3 });
 * // { severity: "warning", message: "… expires in 3 days …", actionLabel: "Renew", … }
 * ```
 */
export function ɵgetLicenseBannerSpec(
  type: ɵLicenseBannerType,
  labels: CopilotChatLabels,
  { featureName, expiryDate, graceRemaining }: ɵLicenseBannerDetails = {},
) {
  switch (type) {
    case "no_license":
      return bannerSpec(
        "info",
        labels.licensePoweredByText,
        labels.licenseGetLicenseLabel,
        PRICING_URL,
      );
    case "feature_unlicensed":
      return bannerSpec(
        "warning",
        ɵformatLabel(labels.licenseFeatureUnlicensedText, {
          feature: featureName ?? "",
        }),
        labels.licenseGetLicenseLabel,
        PRICING_URL,
      );
    case "expiring":
      return bannerSpec(
        "warning",
        expiringMessage(labels, graceRemaining),
        labels.licenseRenewLabel,
        DASHBOARD_URL,
      );
    case "expired":
      return bannerSpec(
        "critical",
        expiryDate
          ? ɵformatLabel(labels.licenseExpiredOnDateText, { date: expiryDate })
          : labels.licenseExpiredText,
        labels.licenseRenewNowLabel,
        PRICING_URL,
      );
    case "invalid":
      return bannerSpec(
        "critical",
        labels.licenseInvalidText,
        labels.licenseGetLicenseLabel,
        PRICING_URL,
      );
  }
}

/** What a license banner shows. See {@link ɵgetLicenseBannerSpec}. */
export interface ɵLicenseBannerSpec {
  severity: ɵLicenseBannerSeverity;
  message: string;
  actionLabel: string;
  actionUrl: string;
}

const bannerSpec = (
  severity: ɵLicenseBannerSeverity,
  message: string,
  actionLabel: string,
  actionUrl: string,
): ɵLicenseBannerSpec => ({ severity, message, actionLabel, actionUrl });

/**
 * The "expires soon" text. Without a day count it says "soon", never "in
 * undefined days".
 */
function expiringMessage(
  labels: CopilotChatLabels,
  graceRemaining: number | undefined,
) {
  if (graceRemaining === undefined) return labels.licenseExpiringText;
  const template =
    graceRemaining === 1
      ? labels.licenseExpiringInDaysOne
      : labels.licenseExpiringInDaysOther;
  return ɵformatLabel(template, { days: graceRemaining });
}

const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

/**
 * Inline styles of the fixed license banner, in camelCase, for React `style`
 * and Vue `:style`. `base` is the layout; `severity` holds the colours.
 */
export const ɵLICENSE_BANNER_STYLE = {
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
    fontFamily: FONT_FAMILY,
    borderRadius: "6px",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
  },
  severity: {
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
  },
  actions: { display: "flex", gap: "8px", alignItems: "center" },
  link: { fontWeight: 600, textDecoration: "underline", color: "inherit" },
  dismiss: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "inherit",
    fontSize: "16px",
  },
} as const;

/**
 * The bottom space the fixed banner takes: banner height (~36px) + bottom
 * offset (8px) + gap above the chat input (~8px). The chat input reads it
 * through `padding-bottom: var(--copilotkit-license-banner-offset)`.
 */
export const ɵLICENSE_BANNER_OFFSET = {
  cssVar: "--copilotkit-license-banner-offset",
  px: 52,
} as const;

/**
 * Publishes {@link ɵLICENSE_BANNER_OFFSET} on the root element while a
 * banner shows. Does nothing without a document (SSR).
 *
 * @returns A function that removes the offset again.
 */
export function ɵreserveLicenseBannerOffset() {
  if (typeof document === "undefined") return () => {};
  const root = document.documentElement;
  root.style.setProperty(
    ɵLICENSE_BANNER_OFFSET.cssVar,
    `${ɵLICENSE_BANNER_OFFSET.px}px`,
  );
  return () => root.style.removeProperty(ɵLICENSE_BANNER_OFFSET.cssVar);
}

/**
 * What the inline warning shows when a chat component needs a license it
 * does not have: the `licenseFeatureUnlicensedText` label and a pricing
 * link. Render it with {@link ɵINLINE_FEATURE_WARNING_STYLE}.
 */
export function ɵgetInlineFeatureWarningSpec(
  featureName: string,
  labels: CopilotChatLabels,
) {
  return {
    message: ɵformatLabel(labels.licenseFeatureUnlicensedText, {
      feature: featureName,
    }),
    actionLabel: "Get one at copilotkit.ai/pricing",
    actionUrl: PRICING_URL,
  };
}

/** Inline styles of the inline feature warning, in camelCase. */
export const ɵINLINE_FEATURE_WARNING_STYLE = {
  container: {
    padding: "8px 12px",
    backgroundColor: "#fffbeb",
    border: "1px solid #fbbf24",
    borderRadius: "6px",
    fontSize: "13px",
    color: "#92400e",
    fontFamily: FONT_FAMILY,
  },
  link: { color: "#b45309", textDecoration: "underline" },
} as const;

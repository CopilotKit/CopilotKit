import { createLicenseContextValue } from "@copilotkit/shared";
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
 * Resolves whether the threads drawer can load its thread list.
 *
 * - `licensed` is `true` when the status is `unknown` (an entitlement lookup
 *   that did not recover, so the threads endpoint decides), or when the
 *   status is `valid` or `expiring` and `checkFeature("threads")` is `true`.
 * - `licensePending` is `true` while the status is `null` (the runtime has
 *   not reported yet). Show the loading state then, not the locked view.
 *
 * @param context - The license context from {@link ɵresolveLicenseState}.
 *
 * @example
 * ```ts
 * const { licensed, licensePending } = ɵresolveThreadsLicense(context);
 * ```
 */
export function ɵresolveThreadsLicense(context: LicenseContextValue) {
  const { status } = context;
  const isLicensePresent = status === "valid" || status === "expiring";
  const isUnresolved = status === "unknown";

  return {
    licensed:
      isUnresolved || (isLicensePresent && context.checkFeature("threads")),
    licensePending: status === null,
  };
}

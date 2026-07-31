import { parseInspectorMetadataV1 } from "@copilotkit/shared";
import type { RuntimeLicenseStatus } from "@copilotkit/shared";

export type InspectorLicenseState = "valid" | "none" | "expired" | "unknown";

export type InspectorMetadataAction = Readonly<{
  kind: "manage_plan" | "renew" | "enable_intelligence";
  url: string;
  label: "Manage plan" | "Renew" | "Enable Intelligence";
}>;

/** Render-safe metadata slots for the Web Inspector. */
export type InspectorMetadataProjection = Readonly<{
  identity?: Readonly<{
    organizationName: string;
    projectName: string;
  }>;
  plan?: Readonly<{
    code: string;
    label: string;
  }>;
  licenseState: InspectorLicenseState;
  hasLicenseConflict: boolean;
  headerAction?: InspectorMetadataAction;
  lockedAction?: InspectorMetadataAction;
}>;

/** Maps the runtime's legacy license status to the inspector's four states. */
export function normalizeRuntimeLicenseState(
  status: RuntimeLicenseStatus | undefined,
): InspectorLicenseState {
  switch (status) {
    case "valid":
    case "expiring":
      return "valid";
    case "none":
      return "none";
    case "expired":
    case "invalid":
      return "expired";
    case "unknown":
    default:
      return "unknown";
  }
}

function projectAction(
  state: InspectorLicenseState,
  action:
    | {
        readonly kind: "manage_plan" | "renew" | "enable_intelligence";
        readonly url: string;
      }
    | undefined,
): Pick<InspectorMetadataProjection, "headerAction" | "lockedAction"> {
  if (state === "valid" && action?.kind === "manage_plan") {
    return {
      headerAction: {
        kind: action.kind,
        url: action.url,
        label: "Manage plan",
      },
    };
  }

  if (state === "none" && action?.kind === "enable_intelligence") {
    return {
      lockedAction: {
        kind: action.kind,
        url: action.url,
        label: "Enable Intelligence",
      },
    };
  }

  if (state === "expired" && action?.kind === "renew") {
    return {
      lockedAction: {
        kind: action.kind,
        url: action.url,
        label: "Renew",
      },
    };
  }

  if (state === "expired" && action?.kind === "manage_plan") {
    return {
      lockedAction: {
        kind: action.kind,
        url: action.url,
        label: "Manage plan",
      },
    };
  }

  return {};
}

/**
 * Re-parses Core metadata at the UI boundary and projects independent,
 * render-safe slots. Usage is deliberately excluded until its UI gate opens.
 */
export function projectInspectorMetadata(
  value: unknown,
  runtimeLicenseStatus: RuntimeLicenseStatus | undefined,
): InspectorMetadataProjection {
  const metadata = parseInspectorMetadataV1(value);
  const runtimeState = normalizeRuntimeLicenseState(runtimeLicenseStatus);
  const metadataState = metadata?.license?.state;
  const hasLicenseConflict =
    metadataState !== undefined &&
    metadataState !== "unknown" &&
    runtimeState !== "unknown" &&
    metadataState !== runtimeState;
  const licenseState = hasLicenseConflict
    ? runtimeState
    : (metadataState ?? runtimeState);

  return {
    ...(metadata?.identity === undefined
      ? {}
      : { identity: metadata.identity }),
    ...(metadata?.plan === undefined ? {} : { plan: metadata.plan }),
    licenseState,
    hasLicenseConflict,
    ...(hasLicenseConflict
      ? {}
      : projectAction(licenseState, metadata?.action)),
  };
}

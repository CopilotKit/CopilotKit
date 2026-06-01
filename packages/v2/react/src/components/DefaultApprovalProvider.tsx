import { useDefaultApproval } from "../hooks/use-default-approval";

/**
 * Internal component that activates the default approval wildcard handler.
 * Rendered conditionally by CopilotKitProvider when `defaultApproval` is enabled.
 */
export function DefaultApprovalProvider() {
  useDefaultApproval();
  return null;
}

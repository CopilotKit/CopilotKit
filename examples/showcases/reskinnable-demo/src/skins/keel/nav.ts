import type { NavRoute } from "@/shell/skin-contract";

/**
 * Visible navigation. NOT the validator for which segments are valid —
 * `resolvePage` in skin.tsx owns that, and it additionally accepts the
 * parameterized routes `knowledge/<docId>` and `runs/<runId>`.
 */
export const keelNav: NavRoute[] = [
  { segment: "", label: "Desk" },
  { segment: "knowledge", label: "Knowledge" },
  { segment: "playbooks", label: "Playbooks" },
  { segment: "runs", label: "Runs" },
];

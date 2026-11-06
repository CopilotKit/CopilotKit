import type { NavRoute } from "@/shell/skin-contract";

/**
 * Visible navigation. NOT the validator for which segments are valid —
 * `resolvePage` in skin.tsx owns that, and it additionally accepts the
 * parameterized routes `knowledge/<docId>` and `runs/<runId>`.
 */
export const keelNav: NavRoute[] = [
  { segment: "", label: "Desk" },
  // The SEGMENT stays `knowledge` while the label reads "Register". The page it
  // resolves to is the policy register — the lifecycle board over the same nine
  // corpus documents — and it is the parent of `knowledge/<docId>`, the route an
  // agent citation deep-links into. Renaming the segment would have moved that
  // landing route, `navigateTo`'s page enum and every citation href for a label.
  { segment: "knowledge", label: "Register" },
  { segment: "playbooks", label: "Playbooks" },
  { segment: "runs", label: "Runs" },
];

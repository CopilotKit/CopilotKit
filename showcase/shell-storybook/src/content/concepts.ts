export const artifacts = {
  "deployment-map": { label: "Shells and services" },
  "cell-states": { label: "Cell states" },
  "demo-picker": { label: "Demo picker" },
  "readiness-check": { label: "Readiness check" },
  "integration-anatomy": { label: "Integration anatomy" },
  "fixture-diff": { label: "Fixture difference" },
  "gap-priority": { label: "Gap priority" },
  "iron-rules": { label: "Four iron rules" },
  "shipping-lane": { label: "Shipping lane" },
  "claim-boundary": { label: "Claim boundary" },
} as const;

export type ArtifactId = keyof typeof artifacts;

// Second hop in the import chain exercised by `ImportedPollenReport.tsx`.
// Verifies the preview bundler walks transitive imports through the render
// component, not just the direct one.
export function describeSeverity(level: number): string {
  if (level <= 2) return "Low";
  if (level <= 4) return "Moderate";
  if (level <= 7) return "High";
  return "Very high";
}

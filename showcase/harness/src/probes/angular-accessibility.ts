interface AxeBrowserApi {
  run(options: unknown): Promise<{
    violations: Array<{ id: string }>;
  }>;
}

/** Run the fixed WCAG rule set through the browser-injected axe API. */
export async function angularAxeViolationIdsInBrowser(): Promise<string[]> {
  const axe = (globalThis as typeof globalThis & { axe?: AxeBrowserApi }).axe;
  if (!axe) throw new Error("axe did not load");
  const result = await axe.run({
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
    },
  });
  return result.violations.map((violation) => violation.id).sort();
}

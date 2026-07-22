/** Resolve the commit represented by an evidence artifact. */
export function commitShaFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return environment.CHECKOUT_SHA ?? environment.GITHUB_SHA ?? "local";
}

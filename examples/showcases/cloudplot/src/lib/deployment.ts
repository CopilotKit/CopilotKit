export function getLangGraphDeploymentUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configuredUrl = environment.LANGGRAPH_DEPLOYMENT_URL?.trim();
  if (configuredUrl) return configuredUrl;

  if (environment.NODE_ENV !== "production") {
    return "http://localhost:8123";
  }

  throw new Error(
    "LANGGRAPH_DEPLOYMENT_URL is required for the Cloudplot frontend service.",
  );
}

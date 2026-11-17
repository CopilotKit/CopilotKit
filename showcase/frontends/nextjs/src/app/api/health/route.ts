// The app container's health check. It answers without loading any agent.
export function GET() {
  return Response.json({ status: "ok" });
}

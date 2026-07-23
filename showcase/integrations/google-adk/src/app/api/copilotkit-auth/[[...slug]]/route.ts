// Re-export the parent handler so Next.js routes sub-paths
// (/api/copilotkit-auth/sse, /api/copilotkit-auth/info, etc.)
// through the same V2 runtime handler.
export { POST, GET } from "../route";

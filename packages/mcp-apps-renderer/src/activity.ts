// The bridge-free activity surface lives in `@copilotkit/shared` so frontends
// can register the activity without depending on this package (it is an
// optional peer). Re-exported here so `@copilotkit/mcp-apps-renderer/activity`
// keeps working for existing consumers.
export {
  MCPAppsActivityType,
  MCPAppsActivityContentSchema,
  ɵrunMcpFollowUp,
  type MCPAppsActivityContent,
  type ɵMcpFollowUpHost,
} from "@copilotkit/shared";

// Unchanged, renderer-owned: kept here because this entry exported it before.
export { MCP_OPEN_LINK_BLOCKED_SCHEMES } from "./constants";

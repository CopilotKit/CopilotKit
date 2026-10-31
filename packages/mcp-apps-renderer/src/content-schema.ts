// The content schema lives in `@copilotkit/shared` so frontends can register
// the activity without this package installed. Re-exported for this package's
// own session code and for existing deep importers.
export {
  MCPAppsActivityContentSchema,
  type MCPAppsActivityContent,
} from "@copilotkit/shared";

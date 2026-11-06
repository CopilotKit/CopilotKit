// The follow-up runner lives in `@copilotkit/shared` so frontends can register
// the activity without this package installed. Re-exported for this package's
// own session code and for existing deep importers.
export { ɵrunMcpFollowUp, type ɵMcpFollowUpHost } from "@copilotkit/shared";

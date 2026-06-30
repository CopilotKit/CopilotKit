/**
 * `@copilotkit/web-components` — framework-agnostic shadow-DOM custom elements
 * for CopilotKit.
 *
 * Currently exposes the `<copilotkit-threads-drawer>` threads drawer. Importing this
 * root re-exports the drawer's public API; `@copilotkit/web-components/threads-drawer`
 * is the focused subpath for tree-shaking when only the drawer is needed.
 */
export * from "./threads-drawer/index";

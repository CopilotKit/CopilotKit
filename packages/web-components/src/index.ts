/**
 * `@copilotkit/web-components` — framework-agnostic shadow-DOM custom elements
 * for CopilotKit.
 *
 * Currently exposes the `<copilotkit-drawer>` threads drawer. Importing this
 * root re-exports the drawer's public API; `@copilotkit/web-components/drawer`
 * is the focused subpath for tree-shaking when only the drawer is needed.
 */
export * from "./drawer/index";

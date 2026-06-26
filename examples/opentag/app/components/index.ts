/**
 * App-specific render components — agent-renderable cards authored with the
 * `@copilotkit/bot-ui` JSX vocabulary. Each component's exported zod prop
 * schema doubles as its render-tool input schema.
 */
export { TagCard, tagCardSchema } from "./tag-card.js";
export type { TagCardProps } from "./tag-card.js";

import { createFromSource } from "fumadocs-core/search/server";
import { source } from "./source";

/** Orama search over the docs, for the "Ask AI" agent and the MCP route. */
export const docsSearch = createFromSource(source);

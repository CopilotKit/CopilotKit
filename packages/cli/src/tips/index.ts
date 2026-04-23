export { createTipEngine } from "./engine.js";
export type {
  Tip,
  TipState,
  TipStrategy,
  TipRenderer,
  TipStore,
} from "./types.js";

// Strategies
export { RandomStrategy } from "./strategies/random.js";
export { SequentialStrategy } from "./strategies/sequential.js";
export { WeightedRandomStrategy } from "./strategies/weighted-random.js";

// Renderers
export { MarkdownTipRenderer } from "./renderers/markdown.js";

// Stores
export { JsonFileTipStore } from "./stores/json-file.js";
export { InMemoryTipStore } from "./stores/in-memory.js";

// Content (hardcoded fallbacks)
export { postCreateTips } from "./content/post-create.js";
export { devTips } from "./content/dev.js";

// Remote loader
export { loadRemoteTips } from "./loaders/remote.js";
export type {
  Alert,
  RemoteTipsConfig,
  RemoteTipResult,
} from "./loaders/remote.js";

// Alert renderer
export { renderAlert } from "./renderers/alert.js";

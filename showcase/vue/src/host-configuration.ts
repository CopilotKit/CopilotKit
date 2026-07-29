import type {
  BrowserCellCatalog,
  BrowserCellResolution,
  VueRuntimeConfig,
} from "./cell-context";
import { resolveBrowserCell } from "./cell-context";
import {
  agentIdForFeature,
  suggestionsForFeature,
  threadIdForFeature,
} from "./feature-contracts";
import type { StaticSuggestion } from "./feature-contracts";
import { resolveFeatureComponentKey } from "./feature-map";
import type { FeatureComponentKey } from "./feature-map";

export interface VueHostConfiguration {
  cellId: string;
  integration: string;
  feature: string;
  runtimeUrl: string;
  agentId: string;
  threadId: string | undefined;
  suggestions: readonly StaticSuggestion[];
  componentKey: FeatureComponentKey;
}

export type VueHostResolution =
  | { kind: "ready"; configuration: VueHostConfiguration }
  | Exclude<BrowserCellResolution, { kind: "runnable" }>;

/** Resolve every runtime and chat decision before Vue constructs the app. */
export function resolveHostConfiguration(
  pathname: string,
  catalog: BrowserCellCatalog,
  runtimeConfig?: VueRuntimeConfig,
): VueHostResolution {
  const cell = resolveBrowserCell(pathname, catalog, runtimeConfig);
  if (cell.kind !== "runnable") return cell;

  let componentKey: FeatureComponentKey;
  try {
    componentKey = resolveFeatureComponentKey(cell.feature);
  } catch {
    return {
      kind: "unavailable",
      cellId: cell.cellId,
      integration: cell.integration,
      feature: cell.feature,
      reason: `Feature "${cell.feature}" does not have a Vue implementation.`,
    };
  }

  return {
    kind: "ready",
    configuration: {
      cellId: cell.cellId,
      integration: cell.integration,
      feature: cell.feature,
      runtimeUrl: cell.runtimeUrl,
      agentId: agentIdForFeature(cell.feature, cell.integration),
      threadId: threadIdForFeature(cell.feature),
      suggestions: suggestionsForFeature(cell.feature),
      componentKey,
    },
  };
}

/** Invoke the mount boundary only after a complete ready configuration exists. */
export function bootstrapVueHost(
  pathname: string,
  catalog: BrowserCellCatalog,
  runtimeConfig: VueRuntimeConfig | undefined,
  mount: (configuration: VueHostConfiguration) => void,
): VueHostResolution {
  const resolution = resolveHostConfiguration(pathname, catalog, runtimeConfig);
  if (resolution.kind === "ready") {
    mount(resolution.configuration);
  }
  return resolution;
}

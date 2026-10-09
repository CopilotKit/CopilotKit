import { REGISTRY_TO_D5 } from "./helpers/d5-feature-mapping.js";
import type { D5FeatureType } from "./helpers/d5-registry.js";

export type RunnableFrontend = "react" | "angular";

interface FrontendCatalogCellInput {
  id: string;
  frontend: string;
  integration: string;
  feature: string;
  runnable: boolean;
}

interface FrontendCatalogInput {
  metadata: { runnable: number };
  cells: readonly FrontendCatalogCellInput[];
}

export interface FrontendMatrixFilter {
  frontends?: readonly RunnableFrontend[];
  integrations?: readonly string[];
  features?: readonly string[];
}

export interface FrontendMatrixCell {
  id: string;
  frontend: RunnableFrontend;
  integration: string;
  feature: string;
  featureTypes: readonly D5FeatureType[];
}

/** Build the complete runnable frontend × backend × feature probe matrix. */
export function buildFrontendMatrix(
  catalog: FrontendCatalogInput,
  filter: FrontendMatrixFilter = {},
): FrontendMatrixCell[] {
  const allRunnable = catalog.cells.filter((cell) => cell.runnable);
  if (allRunnable.length !== catalog.metadata.runnable) {
    throw new Error(
      `frontend catalog runnable metadata says ${catalog.metadata.runnable}; found ${allRunnable.length} cells`,
    );
  }

  const frontendFilter = new Set(filter.frontends ?? []);
  const integrationFilter = new Set(filter.integrations ?? []);
  const featureFilter = new Set(filter.features ?? []);
  const runnable = allRunnable.filter(
    (cell) =>
      (frontendFilter.size === 0 ||
        frontendFilter.has(cell.frontend as RunnableFrontend)) &&
      (integrationFilter.size === 0 ||
        integrationFilter.has(cell.integration)) &&
      (featureFilter.size === 0 || featureFilter.has(cell.feature)),
  );

  const seen = new Set<string>();
  const matrix = runnable.map((cell): FrontendMatrixCell => {
    if (cell.frontend !== "react" && cell.frontend !== "angular") {
      throw new Error(
        `runnable cell "${cell.id}" uses unsupported frontend "${cell.frontend}"`,
      );
    }
    const expectedId = `${cell.frontend}/${cell.integration}/${cell.feature}`;
    if (cell.id !== expectedId) {
      throw new Error(
        `runnable cell id "${cell.id}" must equal "${expectedId}"`,
      );
    }
    if (seen.has(cell.id)) {
      throw new Error(`duplicate runnable frontend cell "${cell.id}"`);
    }
    seen.add(cell.id);

    const featureTypes = REGISTRY_TO_D5[cell.feature];
    if (featureTypes === undefined || featureTypes.length === 0) {
      throw new Error(
        `runnable feature "${cell.feature}" has no deterministic probe mapping`,
      );
    }
    return {
      id: cell.id,
      frontend: cell.frontend,
      integration: cell.integration,
      feature: cell.feature,
      featureTypes,
    };
  });

  return matrix.sort((left, right) => left.id.localeCompare(right.id));
}

/** Split a sorted matrix evenly without dropping or repeating cells. */
export function shardFrontendMatrix(
  matrix: readonly FrontendMatrixCell[],
  shardCount: number,
): FrontendMatrixCell[][] {
  if (!Number.isInteger(shardCount) || shardCount < 1 || shardCount > 256) {
    throw new Error(`shardCount must be an integer from 1 through 256`);
  }
  const shards = Array.from(
    { length: shardCount },
    (): FrontendMatrixCell[] => [],
  );
  [...matrix]
    .sort((left, right) => left.id.localeCompare(right.id))
    .forEach((cell, index) => shards[index % shardCount]!.push(cell));
  return shards;
}

function baseWithoutTrailingSlash(value: string): string {
  const parsed = new URL(value);
  return parsed.href.replace(/\/$/, "");
}

/** Resolve one matrix cell to the exact framework-specific browser route. */
export function urlForFrontendCell(
  cell: FrontendMatrixCell,
  bases: { angularBaseUrl: string; reactBaseUrl: string },
): string {
  if (cell.frontend === "angular") {
    return `${baseWithoutTrailingSlash(bases.angularBaseUrl)}/angular/${cell.feature}`;
  }
  return `${baseWithoutTrailingSlash(bases.reactBaseUrl)}/demos/${cell.feature}`;
}

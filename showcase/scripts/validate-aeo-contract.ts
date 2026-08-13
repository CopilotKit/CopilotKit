import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import type { ErrorObject } from "ajv";

export const AEO_CONTRACT_PATH =
  "showcase/shell-docs/aeo/public-surface-contract.v1.json";
export const AEO_CONTRACT_SCHEMA_PATH =
  "showcase/shell-docs/aeo/public-surface-contract.v1.schema.json";
const SHOWCASE_WORKFLOW_PATH = ".github/workflows/showcase_validate.yml";

interface ContractEndpoint {
  path: string;
  contentTypes: string[];
}

interface AutomatedEnforcement {
  mode: "automated";
  command: string;
  paths: string[];
}

interface ManualExternalEnforcement {
  mode: "manual-external";
  manualOwner: string;
  followUp: string;
}

interface ContractSurface {
  id: string;
  host: "website" | "docs" | "docsMcp";
  endpoints: ContractEndpoint[];
  classification: string;
  owner: string;
  guarantee: string;
  enforcement: AutomatedEnforcement | ManualExternalEnforcement;
}

export interface AeoSurfaceContract {
  schemaVersion: number;
  contractId: string;
  policyUrl: string;
  capabilitiesUrl: string;
  canonicalHosts: Record<"website" | "docs" | "docsMcp", string>;
  classifications: Array<{
    id: string;
    label: string;
    definition: string;
    sourceUrls: string[];
  }>;
  compatibility: Record<string, string>;
  responseSemantics: Record<string, unknown>;
  owners: Array<{
    id: string;
    name: string;
    scope: "repository" | "external-repository" | "external-service";
    repository: string;
    cadence: string;
  }>;
  surfaces: ContractSurface[];
  policyLinkFiles: string[];
  reviewChecklist: string[];
}

function parseJson(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse ${label} ${path}: ${detail}`, {
      cause: error,
    });
  }
}

export function loadAeoSurfaceContract(
  repositoryRoot: string,
): AeoSurfaceContract {
  return parseJson(
    join(repositoryRoot, AEO_CONTRACT_PATH),
    "public AEO contract",
  ) as AeoSurfaceContract;
}

function formatSchemaError(error: ErrorObject): string {
  const location = error.instancePath || "/";
  return `${location} ${error.message ?? "is invalid"}`;
}

function crossReferenceErrors(
  contract: AeoSurfaceContract,
  repositoryRoot: string,
): string[] {
  const errors: string[] = [];
  const classificationIds = new Set<string>();
  for (const classification of contract.classifications) {
    if (classificationIds.has(classification.id)) {
      errors.push(`classification id duplicates ${classification.id}`);
    }
    classificationIds.add(classification.id);
    if (
      classification.id !== "copilotkit-contract" &&
      classification.sourceUrls.length === 0
    ) {
      errors.push(
        `classification ${classification.id} must cite its external authority`,
      );
    }
  }

  const ownerScopes = new Map<
    string,
    AeoSurfaceContract["owners"][number]["scope"]
  >();
  for (const owner of contract.owners) {
    if (ownerScopes.has(owner.id)) {
      errors.push(`owner id duplicates ${owner.id}`);
    }
    ownerScopes.set(owner.id, owner.scope);
  }

  let workflow = "";
  try {
    workflow = readFileSync(
      join(repositoryRoot, SHOWCASE_WORKFLOW_PATH),
      "utf8",
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`unable to read ${SHOWCASE_WORKFLOW_PATH}: ${detail}`);
  }

  const surfaceIds = new Set<string>();
  for (const surface of contract.surfaces) {
    if (surfaceIds.has(surface.id)) {
      errors.push(`surface id duplicates ${surface.id}`);
    }
    surfaceIds.add(surface.id);
    if (!classificationIds.has(surface.classification)) {
      errors.push(
        `surface ${surface.id} references unknown classification ${surface.classification}`,
      );
    }
    const ownerScope = ownerScopes.get(surface.owner);
    if (!ownerScope) {
      errors.push(
        `surface ${surface.id} references unknown owner ${surface.owner}`,
      );
    }

    const endpointPaths = new Set<string>();
    for (const endpoint of surface.endpoints) {
      if (endpointPaths.has(endpoint.path)) {
        errors.push(
          `surface ${surface.id} duplicates endpoint path ${endpoint.path}`,
        );
      }
      endpointPaths.add(endpoint.path);
    }

    if (surface.enforcement.mode === "automated") {
      if (ownerScope !== "repository") {
        errors.push(
          `surface ${surface.id} automated checks require a repository owner`,
        );
      }
      if (!workflow.includes(surface.enforcement.command)) {
        errors.push(
          `automated command is not wired in ${SHOWCASE_WORKFLOW_PATH}: ${surface.enforcement.command}`,
        );
      }
      for (const relativePath of surface.enforcement.paths) {
        if (
          isAbsolute(relativePath) ||
          !existsSync(join(repositoryRoot, relativePath))
        ) {
          errors.push(`automated check path does not exist: ${relativePath}`);
        }
      }
    } else if (ownerScope === "repository") {
      errors.push(
        `surface ${surface.id} manual-external checks require an external owner`,
      );
    }
  }

  for (const relativePath of contract.policyLinkFiles) {
    const fullPath = join(repositoryRoot, relativePath);
    if (!existsSync(fullPath)) {
      errors.push(`policy link file does not exist: ${relativePath}`);
    } else if (!readFileSync(fullPath, "utf8").includes(contract.policyUrl)) {
      errors.push(
        `policy link file does not link ${contract.policyUrl}: ${relativePath}`,
      );
    }
  }
  return errors;
}

export function validateAeoSurfaceContract(
  contract: unknown,
  repositoryRoot: string,
): string[] {
  let schema: unknown;
  try {
    schema = parseJson(
      join(repositoryRoot, AEO_CONTRACT_SCHEMA_PATH),
      "public AEO contract schema",
    );
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }

  const ajv = new Ajv({ allErrors: true, strict: true });
  const validateSchema = ajv.compile(schema as object);
  if (!validateSchema(contract)) {
    return (validateSchema.errors ?? []).map(formatSchemaError);
  }
  return crossReferenceErrors(contract as AeoSurfaceContract, repositoryRoot);
}

export function validateCommittedAeoContract(repositoryRoot: string): void {
  const contract = loadAeoSurfaceContract(repositoryRoot);
  const errors = validateAeoSurfaceContract(contract, repositoryRoot);
  if (errors.length > 0) {
    throw new Error(
      `Public AEO surface contract validation failed:\n${errors
        .map((error) => `- ${error}`)
        .join("\n")}`,
    );
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const repositoryRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  try {
    validateCommittedAeoContract(repositoryRoot);
    console.log(`Public AEO surface contract is valid: ${AEO_CONTRACT_PATH}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

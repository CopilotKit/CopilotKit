import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AEO_CONTRACT_PATH =
  "showcase/shared/aeo/public-surface-contract.v1.json";

const EXPECTED_HOSTS = {
  website: "https://www.copilotkit.ai",
  docs: "https://docs.copilotkit.ai",
  docsMcp: "https://mcp.copilotkit.ai",
} as const;

const EXPECTED_POLICY_URL = "https://docs.copilotkit.ai/aeo";
const EXPECTED_CAPABILITIES_URL =
  "https://docs.copilotkit.ai/.well-known/copilotkit-capabilities/v1.json";
const REQUIRED_CLASSIFICATIONS = [
  "standard",
  "community-convention",
  "copilotkit-contract",
] as const;

type ContractRecord = Record<string, unknown>;

export interface AeoContractOwner {
  id: string;
  name: string;
  scope: "repository" | "external-repository" | "external-service";
  repository: string;
  cadence: string;
}

export interface AutomatedEnforcement {
  mode: "automated";
  command: string;
  paths: string[];
}

export interface ManualExternalEnforcement {
  mode: "manual-external";
  manualOwner: string;
  followUp: string;
}

export interface AeoContractSurface {
  id: string;
  host: keyof typeof EXPECTED_HOSTS;
  path: string;
  classification: (typeof REQUIRED_CLASSIFICATIONS)[number];
  contentTypes: string[];
  owner: string;
  guarantee: string;
  enforcement: AutomatedEnforcement | ManualExternalEnforcement;
}

export interface AeoSurfaceContract extends ContractRecord {
  schemaVersion: number;
  contractId: string;
  policyUrl: string;
  capabilitiesUrl: string;
  canonicalHosts: typeof EXPECTED_HOSTS;
  classifications: Array<{
    id: string;
    label: string;
    definition: string;
    sourceUrls: string[];
  }>;
  compatibility: {
    updateCadence: string;
    additiveChanges: string;
    breakingChanges: string;
    responseTypes: string;
  };
  responseSemantics: {
    successStatus: number;
    missingStatus: number;
    redirectStatuses: number[];
    htmlFallbacks: string;
  };
  owners: AeoContractOwner[];
  surfaces: AeoContractSurface[];
  policyLinkFiles: string[];
  reviewChecklist: string[];
}

function isRecord(value: unknown): value is ContractRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function checkNonEmptyString(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (!nonEmptyString(value)) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => nonEmptyString(item))
  );
}

export function loadAeoSurfaceContract(
  repositoryRoot: string,
): AeoSurfaceContract {
  const contractPath = join(repositoryRoot, AEO_CONTRACT_PATH);
  try {
    return JSON.parse(readFileSync(contractPath, "utf8")) as AeoSurfaceContract;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse ${contractPath}: ${detail}`, {
      cause: error,
    });
  }
}

export function validateAeoSurfaceContract(
  contract: unknown,
  repositoryRoot: string,
): string[] {
  const errors: string[] = [];
  if (!isRecord(contract)) {
    return ["contract must be a JSON object"];
  }

  if (contract.schemaVersion !== 1) {
    errors.push("schemaVersion must equal 1");
  }
  checkNonEmptyString(contract.contractId, "contractId", errors);
  if (contract.policyUrl !== EXPECTED_POLICY_URL) {
    errors.push(`policyUrl must equal ${EXPECTED_POLICY_URL}`);
  }
  if (contract.capabilitiesUrl !== EXPECTED_CAPABILITIES_URL) {
    errors.push(`capabilitiesUrl must equal ${EXPECTED_CAPABILITIES_URL}`);
  }

  if (!isRecord(contract.canonicalHosts)) {
    errors.push("canonicalHosts must be an object");
  } else {
    for (const [key, value] of Object.entries(EXPECTED_HOSTS)) {
      if (contract.canonicalHosts[key] !== value) {
        errors.push(`canonicalHosts.${key} must equal ${value}`);
      }
    }
  }

  const classifications = Array.isArray(contract.classifications)
    ? contract.classifications
    : [];
  if (classifications.length === 0) {
    errors.push("classifications must be a non-empty array");
  }
  const classificationIds = new Set<string>();
  classifications.forEach((classification, index) => {
    const path = `classifications[${index}]`;
    if (!isRecord(classification)) {
      errors.push(`${path} must be an object`);
      return;
    }
    checkNonEmptyString(classification.id, `${path}.id`, errors);
    checkNonEmptyString(classification.label, `${path}.label`, errors);
    checkNonEmptyString(
      classification.definition,
      `${path}.definition`,
      errors,
    );
    if (nonEmptyString(classification.id)) {
      if (classificationIds.has(classification.id)) {
        errors.push(`${path}.id duplicates ${classification.id}`);
      }
      classificationIds.add(classification.id);
    }
    if (!Array.isArray(classification.sourceUrls)) {
      errors.push(`${path}.sourceUrls must be an array`);
    } else if (
      classification.id !== "copilotkit-contract" &&
      classification.sourceUrls.length === 0
    ) {
      errors.push(`${path}.sourceUrls must cite its external authority`);
    }
  });
  for (const classification of REQUIRED_CLASSIFICATIONS) {
    if (!classificationIds.has(classification)) {
      errors.push(`missing required classification: ${classification}`);
    }
  }

  if (!isRecord(contract.compatibility)) {
    errors.push("compatibility must be an object");
  } else {
    for (const field of [
      "updateCadence",
      "additiveChanges",
      "breakingChanges",
      "responseTypes",
    ]) {
      checkNonEmptyString(
        contract.compatibility[field],
        `compatibility.${field}`,
        errors,
      );
    }
  }

  if (!isRecord(contract.responseSemantics)) {
    errors.push("responseSemantics must be an object");
  } else {
    if (contract.responseSemantics.successStatus !== 200) {
      errors.push("responseSemantics.successStatus must equal 200");
    }
    if (contract.responseSemantics.missingStatus !== 404) {
      errors.push("responseSemantics.missingStatus must equal 404");
    }
    if (
      !Array.isArray(contract.responseSemantics.redirectStatuses) ||
      contract.responseSemantics.redirectStatuses.length === 0 ||
      !contract.responseSemantics.redirectStatuses.every(Number.isInteger)
    ) {
      errors.push(
        "responseSemantics.redirectStatuses must be a non-empty integer array",
      );
    }
    checkNonEmptyString(
      contract.responseSemantics.htmlFallbacks,
      "responseSemantics.htmlFallbacks",
      errors,
    );
  }

  const owners = Array.isArray(contract.owners) ? contract.owners : [];
  if (owners.length === 0) {
    errors.push("owners must be a non-empty array");
  }
  const ownerScopes = new Map<string, unknown>();
  owners.forEach((owner, index) => {
    const path = `owners[${index}]`;
    if (!isRecord(owner)) {
      errors.push(`${path} must be an object`);
      return;
    }
    for (const field of ["id", "name", "repository", "cadence"]) {
      checkNonEmptyString(owner[field], `${path}.${field}`, errors);
    }
    if (
      owner.scope !== "repository" &&
      owner.scope !== "external-repository" &&
      owner.scope !== "external-service"
    ) {
      errors.push(`${path}.scope is invalid`);
    }
    if (nonEmptyString(owner.id)) {
      if (ownerScopes.has(owner.id)) {
        errors.push(`${path}.id duplicates ${owner.id}`);
      }
      ownerScopes.set(owner.id, owner.scope);
    }
  });

  const surfaces = Array.isArray(contract.surfaces) ? contract.surfaces : [];
  if (surfaces.length === 0) {
    errors.push("surfaces must be a non-empty array");
  }
  const surfaceIds = new Set<string>();
  surfaces.forEach((surface, index) => {
    const path = `surfaces[${index}]`;
    if (!isRecord(surface)) {
      errors.push(`${path} must be an object`);
      return;
    }
    for (const field of ["id", "path", "owner", "guarantee"]) {
      checkNonEmptyString(surface[field], `${path}.${field}`, errors);
    }
    if (nonEmptyString(surface.id)) {
      if (surfaceIds.has(surface.id)) {
        errors.push(`${path}.id duplicates ${surface.id}`);
      }
      surfaceIds.add(surface.id);
    }
    if (!nonEmptyString(surface.host) || !(surface.host in EXPECTED_HOSTS)) {
      errors.push(`${path}.host must name a canonical host key`);
    }
    if (
      !nonEmptyString(surface.classification) ||
      !classificationIds.has(surface.classification)
    ) {
      errors.push(`${path}.classification is not declared`);
    }
    if (!stringArray(surface.contentTypes)) {
      errors.push(`${path}.contentTypes must be a non-empty string array`);
    }
    if (!nonEmptyString(surface.owner) || !ownerScopes.has(surface.owner)) {
      errors.push(`${path}.owner is not declared`);
    }
    if (!isRecord(surface.enforcement)) {
      errors.push(`${path}.enforcement must be an object`);
      return;
    }

    if (surface.enforcement.mode === "automated") {
      checkNonEmptyString(
        surface.enforcement.command,
        `${path}.enforcement.command`,
        errors,
      );
      if (!stringArray(surface.enforcement.paths)) {
        errors.push(
          `${path}.enforcement.paths must be a non-empty string array`,
        );
      } else {
        for (const relativePath of surface.enforcement.paths) {
          if (
            isAbsolute(relativePath) ||
            !existsSync(join(repositoryRoot, relativePath))
          ) {
            errors.push(`automated check path does not exist: ${relativePath}`);
          }
        }
      }
      if (ownerScopes.get(String(surface.owner)) !== "repository") {
        errors.push(`${path} automated checks require a repository owner`);
      }
    } else if (surface.enforcement.mode === "manual-external") {
      checkNonEmptyString(
        surface.enforcement.manualOwner,
        `${path}.enforcement.manualOwner`,
        errors,
      );
      checkNonEmptyString(
        surface.enforcement.followUp,
        `${path}.enforcement.followUp`,
        errors,
      );
      if (ownerScopes.get(String(surface.owner)) === "repository") {
        errors.push(`${path} manual-external checks require an external owner`);
      }
    } else {
      errors.push(`${path}.enforcement.mode is invalid`);
    }
  });

  if (!stringArray(contract.policyLinkFiles)) {
    errors.push("policyLinkFiles must be a non-empty string array");
  } else {
    for (const relativePath of contract.policyLinkFiles) {
      const fullPath = join(repositoryRoot, relativePath);
      if (!existsSync(fullPath)) {
        errors.push(`policy link file does not exist: ${relativePath}`);
      } else if (
        !readFileSync(fullPath, "utf8").includes(EXPECTED_POLICY_URL)
      ) {
        errors.push(
          `policy link file does not link ${EXPECTED_POLICY_URL}: ${relativePath}`,
        );
      }
    }
  }
  if (!stringArray(contract.reviewChecklist)) {
    errors.push("reviewChecklist must be a non-empty string array");
  }

  return errors;
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

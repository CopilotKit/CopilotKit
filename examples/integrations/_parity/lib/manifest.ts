import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type InstanceRole = "north-star" | "instance";

export interface AgentSurface {
  toolNames: string[];
  stateKeys: string[];
  modelFamily: string;
}

export interface TrackedSurface {
  verbatimFiles: string[];
  packageJsonPaths: string[];
  agentSurface: AgentSurface;
}

export interface InstanceAgent {
  language: "python" | "typescript";
  runtime: string;
}

export interface Instance {
  role: InstanceRole;
  agent: InstanceAgent;
  allowedDivergence: string[];
  packageJsonOverrides: Record<string, string>;
}

export interface Manifest {
  version: number;
  northStar: string;
  canonicalPromptFile: string;
  tracked: TrackedSurface;
  instances: Record<string, Instance>;
}

export interface ParityRoot {
  /** Absolute path to the parity dir, e.g. …/examples/integrations/_parity */
  parityDir: string;
  /** Absolute path to the integrations root, e.g. …/examples/integrations */
  integrationsDir: string;
  manifest: Manifest;
}

export function loadManifest(parityDir: string): ParityRoot {
  const manifestPath = resolve(parityDir, "manifest.json");
  const raw = readFileSync(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as Manifest;
  validate(parsed, manifestPath);
  return {
    parityDir,
    integrationsDir: resolve(parityDir, ".."),
    manifest: parsed,
  };
}

function validate(m: Manifest, source: string): void {
  const err = (msg: string): never => {
    throw new Error(`[parity] invalid manifest at ${source}: ${msg}`);
  };
  if (m.version !== 1) err(`unsupported version ${m.version}`);
  if (!m.northStar) err("missing northStar");
  if (!m.instances?.[m.northStar])
    err(`northStar '${m.northStar}' not in instances`);
  if (m.instances[m.northStar].role !== "north-star")
    err(`northStar '${m.northStar}' must have role=north-star`);

  const nonNorthStar = Object.entries(m.instances).filter(
    ([n]) => n !== m.northStar,
  );
  for (const [name, inst] of nonNorthStar) {
    if (inst.role !== "instance")
      err(`instance '${name}' must have role=instance`);
  }

  if (!m.tracked?.verbatimFiles?.length) err("tracked.verbatimFiles empty");
  if (!m.tracked?.packageJsonPaths?.length)
    err("tracked.packageJsonPaths empty");
  if (!m.tracked?.agentSurface?.toolNames?.length)
    err("tracked.agentSurface.toolNames empty");
}

export function instanceDir(root: ParityRoot, name: string): string {
  return resolve(root.integrationsDir, name);
}

export function northStarDir(root: ParityRoot): string {
  return instanceDir(root, root.manifest.northStar);
}

export function listInstances(root: ParityRoot): string[] {
  return Object.keys(root.manifest.instances).filter(
    (n) => n !== root.manifest.northStar,
  );
}

import type { CompatibilitySnapshotRow } from "../../src/data/compatibility-snapshot";

export type Registry = "npm" | "pypi" | "nuget" | "maven";
export type ReleasePolicy = "stable" | "stable-or-ms-preview";
export type SourceSpec = {
  kind: "requirements" | "npm" | "csproj" | "pom";
  path: string;
  lockPath?: string;
  property?: string;
  managedBy?: string;
  transitive?: boolean;
};
export interface LibraryMapping {
  name: string;
  registry: Registry;
  role: "framework";
  required: boolean;
  reason: string;
  source: SourceSpec;
  releasePolicy: ReleasePolicy;
}
export interface VariantMapping {
  slug: string;
  language: string;
  excludedReason?: string;
  libraries: LibraryMapping[];
  excludedLibraries: { name: string; reason: string }[];
}
export interface RawResponse {
  url: string;
  status: number;
  observedAt: string;
  body: string;
}
export interface HttpClient {
  get(url: string, accept?: string): Promise<RawResponse>;
}
export interface Release {
  version: string;
  timestamp: string | null;
  timestampKind: "published" | "registry-last-updated";
  eligible: boolean;
}
export interface Inventory {
  registry: Registry;
  name: string;
  sourceUrl: string;
  releases: Release[];
  complete: boolean;
  diagnostics: string[];
}
export interface VersionFact {
  version: string | null;
  basis: "source-declared" | "source-lock" | "unknown";
  evidence: string[];
  reason: string;
}
export type SavedFileReader = (path: string) => string;
export interface CompatibilitySnapshotValue {
  date: string;
  assessedAt: string;
  methodology: string;
  rows: CompatibilitySnapshotRow[];
}
export interface CollectOptions {
  out: string;
  asOf: string;
  writeSnapshot?: boolean;
}

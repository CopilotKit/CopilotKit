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

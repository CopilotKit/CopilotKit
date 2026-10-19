import type { CompatibilitySnapshotRow } from "../../src/data/compatibility-snapshot";

import type { Registry } from "../../../harness/src/shared/compatibility-mapping-types";
export type {
  Registry,
  ReleasePolicy,
  SourceSpec,
  LibraryMapping,
  VariantMapping,
} from "../../../harness/src/shared/compatibility-mapping-types";

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
  /** Full source commit of each deployed integration; never falls back to main. */
  sourceCommits?: Record<string, string>;
}

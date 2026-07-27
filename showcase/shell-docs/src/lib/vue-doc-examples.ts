import path from "node:path";
import vueDocExamplesData from "@/data/vue-doc-examples.json";

interface VueDocRegion {
  code: string;
  startLine: number;
  endLine: number;
}

interface VueDocSourceFile {
  language: string;
  code: string;
  regions: Record<string, VueDocRegion>;
}

interface VueDocExamplesBundle {
  version: number;
  files: Record<string, VueDocSourceFile>;
}

export interface ResolvedVueDocExample {
  file: string;
  region?: string;
  language: string;
  code: string;
}

const bundle = vueDocExamplesData as VueDocExamplesBundle;

function assertSafePath(file: string): void {
  if (
    path.isAbsolute(file) ||
    file.includes("\\") ||
    file.split("/").some((segment) => segment === "" || segment === "..")
  ) {
    throw new Error(`unsafe file path "${file}"`);
  }
}

export function resolveVueDocExample(
  file: string | undefined,
  region?: string,
): ResolvedVueDocExample {
  if (!file) {
    throw new Error('missing required "file" attribute');
  }
  assertSafePath(file);

  const sourceFile = bundle.files[file];
  if (!sourceFile) {
    throw new Error(`file "${file}" is not bundled`);
  }

  if (region !== undefined) {
    if (!region) {
      throw new Error('"region" must not be empty');
    }
    const sourceRegion = sourceFile.regions[region];
    if (!sourceRegion) {
      throw new Error(`region "${region}" is missing from "${file}"`);
    }
    return {
      file,
      region,
      language: sourceFile.language,
      code: sourceRegion.code,
    };
  }

  return {
    file,
    language: sourceFile.language,
    code: sourceFile.code.replace(/\n$/, ""),
  };
}

export function vueDocExampleDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown error";
  return `VueDocExample error: ${message}`;
}

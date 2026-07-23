/**
 * Constraint Validator
 *
 * Validates that a manifest's declared demos are compatible with its
 * declared generative_ui approaches and interaction_modalities.
 *
 * Usage:
 *   npx tsx showcase/scripts/validate-constraints.ts <slug>
 *   npx tsx showcase/scripts/validate-constraints.ts --all
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONSTRAINTS_PATH = path.join(ROOT, "shared", "constraints.yaml");
const PACKAGES_DIR = path.join(ROOT, "integrations");

interface Constraints {
  generative_ui: Record<string, { allowed?: string[]; excluded?: string[] }>;
  interaction_modalities: Record<string, { excluded?: string[] }>;
}

interface Manifest {
  slug: string;
  generative_ui?: string[];
  interaction_modalities?: string[];
  demos: Array<{ id: string; name: string }>;
}

function loadConstraints(): Constraints {
  const raw = fs.readFileSync(CONSTRAINTS_PATH, "utf-8");
  return yaml.parse(raw) as Constraints;
}

function loadManifest(slug: string): Manifest {
  const manifestPath = path.join(PACKAGES_DIR, slug, "manifest.yaml");
  const raw = fs.readFileSync(manifestPath, "utf-8");
  return yaml.parse(raw) as Manifest;
}

export function validateManifestConstraints(
  manifest: Manifest,
  constraints: Constraints,
): string[] {
  const errors: string[] = [];

  // Skip if manifest doesn't declare these optional fields
  const genUiApproaches = manifest.generative_ui;
  const modalities = manifest.interaction_modalities;

  for (const demo of manifest.demos) {
    // Generative UI validation (allowlist-based)
    if (genUiApproaches && genUiApproaches.length > 0) {
      const allowedByAny = genUiApproaches.some((approach) => {
        const rule = constraints.generative_ui[approach];
        return rule?.allowed?.includes(demo.id) ?? false;
      });

      if (!allowedByAny) {
        const declared = genUiApproaches.join(", ");
        errors.push(
          `[${manifest.slug}] Demo '${demo.id}' is not allowed by any declared generative_ui approach [${declared}]`,
        );
      }
    }

    // Interaction modality validation (denylist-based)
    if (modalities && modalities.length > 0) {
      const excludedByAll = modalities.every((modality) => {
        const rule = constraints.interaction_modalities[modality];
        return rule?.excluded?.includes(demo.id) ?? false;
      });

      if (excludedByAll) {
        const declared = modalities.join(", ");
        errors.push(
          `[${manifest.slug}] Demo '${demo.id}' is excluded by all declared interaction_modalities [${declared}]`,
        );
      }
    }
  }

  return errors;
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help") {
    console.log("Usage:");
    console.log("  npx tsx validate-constraints.ts <slug>");
    console.log("  npx tsx validate-constraints.ts --all");
    process.exit(0);
  }

  const constraints = loadConstraints();
  let slugs: string[];

  if (args[0] === "--all") {
    slugs = fs
      .readdirSync(PACKAGES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .filter((d) =>
        fs.existsSync(path.join(PACKAGES_DIR, d.name, "manifest.yaml")),
      )
      .map((d) => d.name);
  } else {
    slugs = [args[0]];
  }

  let allErrors: string[] = [];

  for (const slug of slugs) {
    const manifest = loadManifest(slug);
    const errors = validateManifestConstraints(manifest, constraints);
    if (errors.length > 0) {
      allErrors.push(...errors);
    } else {
      console.log(`  OK: ${slug} (constraints valid)`);
    }
  }

  if (allErrors.length > 0) {
    console.error("\nConstraint validation errors:");
    for (const err of allErrors) {
      console.error(`  ERROR: ${err}`);
    }
    process.exit(1);
  }
}

// Only run main when executed directly (not when imported as a module)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

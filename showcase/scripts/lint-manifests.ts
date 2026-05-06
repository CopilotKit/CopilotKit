import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseManifestV2 } from "./lib/manifest-v2.js";
import { parseDemoCatalog } from "./lib/demos-yaml.js";

export type Finding = {
  readonly rule: "factories-sync" | "catalog-membership" | "paths-exist";
  readonly framework?: string;
  readonly message: string;
};

const FACTORY_BLOCK = /AGENT_FACTORIES\s*[:=]\s*\{([\s\S]*?)\}/;
const KEY_PATTERN = /["']([a-z][a-z0-9-]*)["']\s*:/g;

function parseAgentFactories(serverSource: string): string[] | null {
  const block = serverSource.match(FACTORY_BLOCK);
  if (!block) return null;
  const keys: string[] = [];
  let m: RegExpExecArray | null;
  const inner = block[1];
  while ((m = KEY_PATTERN.exec(inner)) !== null) keys.push(m[1]);
  return keys;
}

function listFrameworks(rootDir: string): string[] {
  const agentsDir = path.join(rootDir, "agents");
  if (!fs.existsSync(agentsDir)) return [];
  return fs.readdirSync(agentsDir)
    .filter(n => fs.statSync(path.join(agentsDir, n)).isDirectory())
    .filter(n => fs.existsSync(path.join(agentsDir, n, "manifest.yaml")));
}

export function lintManifestSet(rootDir: string): Finding[] {
  const findings: Finding[] = [];
  const fws = listFrameworks(rootDir);
  const demosYamlPath = path.join(rootDir, "nextjs", "demos.yaml");
  let catalogIds = new Set<string>();
  if (fs.existsSync(demosYamlPath)) {
    const p = parseDemoCatalog(fs.readFileSync(demosYamlPath, "utf-8"));
    if (p.kind === "ok") catalogIds = new Set(p.entries.map(e => e.id));
  }

  for (const slug of fws) {
    const fwRoot = path.join(rootDir, "agents", slug);
    const manifestPath = path.join(fwRoot, "manifest.yaml");
    const parsed = parseManifestV2(fs.readFileSync(manifestPath, "utf-8"));
    if (parsed.kind !== "ok") {
      findings.push({ rule: "factories-sync", framework: slug, message: `manifest malformed: ${parsed.reason}` });
      continue;
    }
    const m = parsed.manifest;
    const manifestIds = new Set(m.demos.map(d => d.id));

    const serverPath = path.join(fwRoot, "src", "agent_server.py");
    if (fs.existsSync(serverPath)) {
      const facts = parseAgentFactories(fs.readFileSync(serverPath, "utf-8"));
      if (facts === null) {
        findings.push({ rule: "factories-sync", framework: slug, message: "AGENT_FACTORIES not found in agent_server.py" });
      } else {
        const set = new Set(facts);
        for (const id of manifestIds)
          if (!set.has(id)) findings.push({ rule: "factories-sync", framework: slug, message: `'${id}' in manifest but missing from AGENT_FACTORIES` });
        for (const id of set)
          if (!manifestIds.has(id)) findings.push({ rule: "factories-sync", framework: slug, message: `'${id}' in AGENT_FACTORIES but missing from manifest` });
      }
    }

    if (catalogIds.size > 0) {
      for (const id of manifestIds)
        if (!catalogIds.has(id)) findings.push({ rule: "catalog-membership", framework: slug, message: `'${id}' in manifest but missing from nextjs/demos.yaml` });
    }

    for (const d of m.demos)
      for (const rel of d.backend_highlight)
        if (!fs.existsSync(path.join(fwRoot, rel)))
          findings.push({ rule: "paths-exist", framework: slug, message: `'${d.id}': backend highlight not found: ${rel}` });
  }

  if (fs.existsSync(demosYamlPath)) {
    const p = parseDemoCatalog(fs.readFileSync(demosYamlPath, "utf-8"));
    if (p.kind === "ok") {
      const frontendRoot = path.join(rootDir, "nextjs");
      for (const e of p.entries)
        for (const rel of e.frontend_highlight)
          if (!fs.existsSync(path.join(frontendRoot, rel)))
            findings.push({ rule: "paths-exist", message: `'${e.id}': frontend highlight not found: ${rel}` });
    }
  }

  return findings;
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const root = path.resolve(path.dirname(__filename), "..", "integrations");
  const findings = lintManifestSet(root);
  if (findings.length === 0) {
    console.log("[lint-manifests] OK — no findings");
    process.exit(0);
  }
  console.warn(`[lint-manifests] ${findings.length} finding(s):`);
  for (const f of findings) {
    const fw = f.framework ? `[${f.framework}] ` : "";
    console.warn(`  - (${f.rule}) ${fw}${f.message}`);
  }
  // Phase 0: warnings mode — always exit 0. Phase 4 promotes to exit 1.
  process.exit(0);
}

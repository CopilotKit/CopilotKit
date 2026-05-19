import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const READY_SLUGS = new Set([
  "langgraph-python",
  "langgraph-typescript",
  "google-adk",
]);

interface RegistryIntegration {
  slug: string;
  deployed: boolean;
}

interface Registry {
  integrations: RegistryIntegration[];
}

export function listUnreadyFrameworks(): string[] {
  const registryPath = path.join(
    ROOT,
    "shell-docs",
    "src",
    "data",
    "registry.json",
  );
  const registry = JSON.parse(
    fs.readFileSync(registryPath, "utf-8"),
  ) as Registry;
  return registry.integrations
    .filter((i) => i.deployed && !READY_SLUGS.has(i.slug))
    .map((i) => i.slug)
    .sort();
}

import fs from "fs";
import path from "path";

export const ROOT = path.resolve(import.meta.dirname, "../../..");

export interface ReleaseConfig {
  prereleaseTag: string;
  versionedTogether: string[];
  versionedIndependently: string[];
}

export function loadConfig(): ReleaseConfig {
  const configPath = path.join(ROOT, "release.config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

import * as fs from "node:fs";
import * as path from "node:path";
import type { RecordedCall } from "./vscode-lm-factory";

export interface FixtureMetadata {
  name: string;
  createdAt: string;
  modelId: string;
  modelVendor: string;
  version: 2;
}

export interface SavedFixture {
  metadata: FixtureMetadata;
  calls: RecordedCall[];
}

export interface FixtureListEntry {
  filePath: string;
  metadata: FixtureMetadata;
}

export interface FixtureStoreOptions {
  onWarn?: (message: string) => void;
}

/**
 * Filesystem-backed store for playground chat fixtures. Each fixture is a
 * single JSON file under `<workspaceRoot>/.copilotkit/fixtures/`. The v2
 * format stores recorded vscode-lm calls; v1 (journal-shaped) files are
 * skipped with a warning — they were dev artifacts only.
 */
export class FixtureStore {
  private readonly onWarn: (message: string) => void;

  constructor(
    private readonly workspaceRoot: string,
    opts: FixtureStoreOptions = {},
  ) {
    this.onWarn = opts.onWarn ?? (() => {});
  }

  private fixturesDir(): string {
    return path.join(this.workspaceRoot, ".copilotkit", "fixtures");
  }

  list(): FixtureListEntry[] {
    const dir = this.fixturesDir();
    if (!fs.existsSync(dir)) return [];
    const entries: FixtureListEntry[] = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const filePath = path.join(dir, name);
      try {
        const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (content?.metadata?.version === 2) {
          entries.push({ filePath, metadata: content.metadata });
        } else {
          this.onWarn(
            `[fixture-store] skipping v1 fixture ${filePath} — pre-vscode.lm format`,
          );
        }
      } catch {
        // Corrupt file — skip silently.
      }
    }
    return entries.sort((a, b) =>
      a.metadata.createdAt < b.metadata.createdAt ? 1 : -1,
    );
  }

  read(filePath: string): SavedFixture {
    if (!filePath.startsWith(this.fixturesDir())) {
      throw new Error("refusing to read file outside fixtures directory");
    }
    const content = JSON.parse(
      fs.readFileSync(filePath, "utf-8"),
    ) as SavedFixture;
    return content;
  }

  save(metadata: FixtureMetadata, body: { calls: RecordedCall[] }): string {
    const dir = this.fixturesDir();
    fs.mkdirSync(dir, { recursive: true });
    const safeName = sanitizeName(metadata.name) || "fixture";
    const filePath = path.join(dir, `${safeName}.json`);
    const payload: SavedFixture = { metadata, calls: body.calls };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
    return filePath;
  }

  delete(filePath: string): void {
    if (!filePath.startsWith(this.fixturesDir())) {
      throw new Error("refusing to delete file outside fixtures directory");
    }
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

function sanitizeName(name: string): string {
  return name
    .replace(/\.\./g, "_")
    .replace(/[\\/]/g, "-")
    .replace(/[^\w.\-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 100);
}

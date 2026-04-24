import * as fs from "node:fs";
import * as path from "node:path";

export interface FixtureMetadata {
  name: string;
  createdAt: string;
  provider: "openai" | "anthropic";
  model: string;
}

export interface SavedFixture {
  metadata: FixtureMetadata;
  recording: unknown[];
}

export interface FixtureListEntry {
  filePath: string;
  metadata: FixtureMetadata;
}

/**
 * Filesystem-backed store for playground chat fixtures. Each fixture is a
 * single JSON file under `<workspaceRoot>/.copilotkit/fixtures/`. Metadata +
 * recording travel together in the same file. The recording shape is
 * deliberately `unknown[]` — aimock's journal format is pass-through.
 */
export class FixtureStore {
  constructor(private readonly workspaceRoot: string) {}

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
        const content = JSON.parse(fs.readFileSync(filePath, "utf-8")) as
          | SavedFixture
          | { metadata?: FixtureMetadata };
        if (content.metadata) {
          entries.push({
            filePath,
            metadata: content.metadata as FixtureMetadata,
          });
        }
      } catch {
        // Corrupt file — skip.
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
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as SavedFixture;
  }

  save(metadata: FixtureMetadata, body: { recording: unknown[] }): string {
    const dir = this.fixturesDir();
    fs.mkdirSync(dir, { recursive: true });
    const safeName = sanitizeName(metadata.name) || "fixture";
    const filePath = path.join(dir, `${safeName}.json`);
    // Translate aimock's JournalEntry[] → aimock-native `fixtures[]` shape
    // so `mock.loadFixtureFile(path)` in replay mode actually matches
    // incoming requests. aimock reads `.fixtures`; our metadata + raw
    // recording ride alongside for the webview sidebar and debugging.
    const fixtures = extractAimockFixtures(body.recording);
    const payload = {
      metadata,
      fixtures,
      recording: body.recording,
    };
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

/**
 * Extracts aimock-native Fixture objects from a JournalEntry[] recording so
 * that `LLMock.loadFixtureFile()` can replay them. Each journal entry has
 * `response.fixture` set to the Fixture that matched (when aimock proxied +
 * recorded from upstream, it synthesizes one). Entries without a fixture
 * (unmatched replay misses) are skipped.
 */
function extractAimockFixtures(recording: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const entry of recording) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as {
      response?: { fixture?: unknown };
    };
    const fixture = e.response?.fixture;
    if (fixture != null) out.push(fixture);
  }
  return out;
}

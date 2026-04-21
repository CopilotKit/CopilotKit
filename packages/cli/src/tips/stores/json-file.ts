import fs from "fs";
import path from "path";
import os from "os";
import { TipState, TipStore } from "../types.js";

const DEFAULT_PATH = path.join(os.homedir(), ".copilotkit", "tips.json");

export class JsonFileTipStore implements TipStore {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_PATH;
  }

  async load(): Promise<TipState> {
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const data = JSON.parse(raw);
      return {
        shownTipIds: Array.isArray(data.shownTipIds) ? data.shownTipIds : [],
        lastShownAt:
          typeof data.lastShownAt === "string" ? data.lastShownAt : undefined,
      };
    } catch {
      return { shownTipIds: [] };
    }
  }

  async save(state: TipState): Promise<void> {
    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), "utf-8");
    } catch {
      // Non-critical — silently swallow persistence failures
    }
  }
}

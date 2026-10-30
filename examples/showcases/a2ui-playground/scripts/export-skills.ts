/**
 * Writes the agent skills generated from the catalog to skills/generated/<format>/,
 * the same files /skills serves.
 *
 *   pnpm skills:export            (Express and JSON)
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { generateSkills, type SkillFormat } from "../src/a2ui/export/skills";

for (const format of ["express", "json"] as SkillFormat[]) {
  const dir = join(__dirname, "../skills/generated", format);
  rmSync(dir, { recursive: true, force: true });
  const files = generateSkills(format);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  console.log(`${format}: ${Object.keys(files).join(", ")} -> skills/generated/${format}`);
}

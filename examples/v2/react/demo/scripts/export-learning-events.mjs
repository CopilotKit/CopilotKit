// Prints every captured learning event from .data/learning.sqlite as JSON.
// Usage: pnpm --filter demo learning:export > learning-events.json
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const path = join(process.cwd(), ".data", "learning.sqlite");
if (!existsSync(path)) {
  console.error(
    `No database at ${path}. Run the demo and use /learning first.`,
  );
  process.exit(1);
}

const db = new DatabaseSync(path, { readOnly: true });
const rows = db
  .prepare(
    "SELECT trajectory_id, seq, name, thread_id, timestamp, value FROM events ORDER BY trajectory_id, seq, id",
  )
  .all()
  .map((row) => ({
    trajectoryId: row.trajectory_id,
    threadId: row.thread_id,
    event: {
      type: "CUSTOM",
      name: row.name,
      timestamp: row.timestamp,
      value: JSON.parse(String(row.value)),
    },
  }));

console.log(JSON.stringify(rows, null, 2));

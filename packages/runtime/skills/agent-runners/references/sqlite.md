SqliteAgentRunner — file-backed agent runner in `@copilotkit/sqlite-runner`. Uses `better-sqlite3` as a required peer dep.

## Install

```bash
pnpm add @copilotkit/sqlite-runner better-sqlite3
```

If `better-sqlite3` is missing, the `import` of `@copilotkit/sqlite-runner` itself fails
at module load (`Cannot find module 'better-sqlite3'`). The runner's constructor has a
friendlier multi-line install hint as a fallback, but you will see the bare resolution
error first — install the peer before the runner import resolves.

## Configure

```typescript
import { CopilotRuntime } from "@copilotkit/runtime/v2";
import { SqliteAgentRunner } from "@copilotkit/sqlite-runner";

const runtime = new CopilotRuntime({
  agents: {
    /* ... */
  } as any,
  runner: new SqliteAgentRunner({
    dbPath: "./data/threads.db", // REQUIRED — default is ":memory:"
  }),
});
```

`dbPath: ":memory:"` is the default if omitted — that reverts to an in-memory store and
loses data at restart. Always set a file path in production.

## Schema

Two tables are created on first use:

```sql
CREATE TABLE IF NOT EXISTS agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  parent_run_id TEXT,
  events TEXT NOT NULL,    -- JSON-encoded BaseEvent[]
  input TEXT NOT NULL,     -- JSON-encoded RunAgentInput
  created_at INTEGER NOT NULL,
  version INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS run_state (
  thread_id TEXT PRIMARY KEY,
  is_running INTEGER DEFAULT 0,
  current_run_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_thread_id ON agent_runs(thread_id);
CREATE INDEX IF NOT EXISTS idx_parent_run_id ON agent_runs(parent_run_id);
```

`run_state` gates concurrent runs (the `"Thread already running"` check). `agent_runs` is
append-only — one row per completed run, full event log in the `events` column.

## Retention

There is no automatic retention. If you need bounded history, add a periodic purge:

```typescript
import Database from "better-sqlite3";

const db = new Database("./data/threads.db");
setInterval(
  () => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
    db.prepare("DELETE FROM agent_runs WHERE created_at < ?").run(cutoff);
  },
  60 * 60 * 1000,
);
```

## When NOT to use

- Multi-instance deploys without shared storage — each instance would have its own DB file.
  Either put the DB on a shared volume (EFS, persistent disk) with a single writer, or
  choose Intelligence mode or a custom Redis/Postgres runner.

Source: `packages/sqlite-runner/src/sqlite-runner.ts`.

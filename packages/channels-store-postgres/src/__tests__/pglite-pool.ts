import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";

type QueryResult = { rows: unknown[]; rowCount: number };

/**
 * A node-postgres `Pool` over PGlite (real Postgres compiled to WASM), for
 * hermetic tests.
 *
 * PGlite has one session, so this behaves like a pool of size 1: a checked-out
 * client (`connect()`) holds the session until `release()`, and `pool.query`
 * waits for it. That keeps each `BEGIN ... COMMIT` block from interleaving with
 * other statements, as separate pool connections would.
 */
export class PglitePool {
  ended = false;
  private tail: Promise<void> = Promise.resolve();

  constructor(readonly db: PGlite) {}

  static async create(): Promise<PglitePool> {
    return new PglitePool(await PGlite.create());
  }

  /** Typed as a `pg.Pool` for the store's `pool` option. */
  asPool(): Pool {
    return this as unknown as Pool;
  }

  query = async (text: string, params?: unknown[]): Promise<QueryResult> => {
    const release = await this.acquire();
    try {
      return await this.run(text, params);
    } finally {
      release();
    }
  };

  connect = async (): Promise<{
    query: (text: string, params?: unknown[]) => Promise<QueryResult>;
    release: () => void;
  }> => {
    const release = await this.acquire();
    return { query: (text, params) => this.run(text, params), release };
  };

  end = async (): Promise<void> => {
    this.ended = true;
    await this.db.close();
  };

  private acquire(): Promise<() => void> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const prev = this.tail;
    this.tail = prev.then(() => held);
    return prev.then(() => release);
  }

  private async run(text: string, params?: unknown[]): Promise<QueryResult> {
    // pg runs a parameterless query with the simple protocol, which allows
    // several statements (as `migrate()` sends). PGlite's `exec` does the same.
    const results = params
      ? [await this.db.query(text, params)]
      : await this.db.exec(text);
    const last = results[results.length - 1]!;
    return {
      rows: last.rows,
      rowCount: last.rowCount ?? last.affectedRows ?? last.rows.length,
    };
  }
}

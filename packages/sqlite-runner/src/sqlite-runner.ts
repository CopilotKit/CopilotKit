import {
  AgentRunner,
  ThreadAccessDeniedError,
  ThreadAlreadyRunningError,
  finalizeRunEvents,
  ɵresolveThreadOwner,
} from "@copilotkit/runtime";
import type {
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
  AgentRunnerStopRequest,
  LocalThreadEndpointScope,
} from "@copilotkit/runtime";
import type { Observable } from "rxjs";
import { ReplaySubject } from "rxjs";
import type {
  AbstractAgent,
  BaseEvent,
  RunAgentInput,
  RunStartedEvent,
} from "@ag-ui/client";
import { EventType, compactEvents } from "@ag-ui/client";
import Database from "better-sqlite3";

/**
 * 2: adds `thread_owners`. Also written as the `version` of each stored run,
 * so runs stored from now on are tagged 2.
 */
const SCHEMA_VERSION = 2;

/**
 * Owner of a legacy thread: one whose runs were stored before owners were
 * recorded (schema 1), so it has runs but no `thread_owners` row. Before the
 * upgrade, every caller that held a thread id could reach that thread. A
 * legacy thread keeps exactly that: it stays a capability, reachable by id for
 * every caller and every identity, and continuing it never claims it. Only a
 * thread that has no runs yet is claimed, by its first run, so no new thread
 * can become legacy. The value holds a NUL character, which no request
 * identity can hold.
 */
const LEGACY_THREAD_OWNER = "\u0000legacy";

interface AgentRunRecord {
  id: number;
  thread_id: string;
  run_id: string;
  parent_run_id: string | null;
  events: BaseEvent[];
  input: RunAgentInput;
  created_at: number;
  version: number;
}

export interface SqliteAgentRunnerOptions {
  dbPath?: string;
}

interface ActiveConnectionContext {
  subject: ReplaySubject<BaseEvent>;
  agent?: AbstractAgent;
  runSubject?: ReplaySubject<BaseEvent>;
  currentEvents?: BaseEvent[];
  stopRequested?: boolean;
}

export class SqliteAgentRunner extends AgentRunner {
  private db: any;

  /**
   * Live runs of this runner, by thread id, for streaming and stop. Kept per
   * instance: owners are checked against this instance's database, so a live
   * run of another runner, which may hold the same thread id for a different
   * owner, must never be bridged, stopped or torn down from here.
   */
  private readonly activeConnections = new Map<
    string,
    ActiveConnectionContext
  >();

  constructor(options: SqliteAgentRunnerOptions = {}) {
    super();
    const dbPath = options.dbPath ?? ":memory:";

    if (!Database) {
      throw new Error(
        "better-sqlite3 is required for SqliteAgentRunner but was not found.\n" +
          "Please install it in your project:\n" +
          "  npm install better-sqlite3\n" +
          "  or\n" +
          "  pnpm add better-sqlite3\n" +
          "  or\n" +
          "  yarn add better-sqlite3\n\n" +
          "If you don't need persistence, use InMemoryAgentRunner instead.",
      );
    }

    this.db = new Database(dbPath);
    this.initializeSchema();
    this.warnIfLegacyThreads();
  }

  /**
   * Logs once, when the database opens, how many legacy threads it holds
   * (see {@link LEGACY_THREAD_OWNER}), so operators know those threads are
   * still reachable by id for every caller.
   */
  private warnIfLegacyThreads(): void {
    const row = this.db
      .prepare(
        "SELECT COUNT(DISTINCT thread_id) AS count FROM agent_runs WHERE thread_id NOT IN (SELECT thread_id FROM thread_owners)",
      )
      .get() as { count: number } | undefined;
    const count = row?.count ?? 0;
    if (count === 0) return;
    console.warn(
      `[CopilotKit] SqliteAgentRunner: ${count} thread${count === 1 ? " was" : "s were"} ` +
        "stored before thread owners were recorded. Anyone who holds the id of " +
        "one of them can still read, continue and stop it, as before the upgrade, " +
        "whatever identifyUser returns. Threads created from now on belong to the " +
        "identity whose run created them.",
    );
  }

  private initializeSchema(): void {
    // Create the agent_runs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        run_id TEXT NOT NULL UNIQUE,
        parent_run_id TEXT,
        events TEXT NOT NULL,
        input TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        version INTEGER NOT NULL
      )
    `);

    // Create run_state table to track active runs
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS run_state (
        thread_id TEXT PRIMARY KEY,
        is_running INTEGER DEFAULT 0,
        current_run_id TEXT,
        updated_at INTEGER NOT NULL
      )
    `);

    // The identity that owns each thread, recorded by the thread's first run.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thread_owners (
        thread_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // Create indexes for efficient queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_thread_id ON agent_runs(thread_id);
      CREATE INDEX IF NOT EXISTS idx_parent_run_id ON agent_runs(parent_run_id);
    `);

    // Create schema version table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);

    // Check and set schema version
    const currentVersion = this.db
      .prepare(
        "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
      )
      .get() as { version: number } | undefined;

    if (!currentVersion || currentVersion.version < SCHEMA_VERSION) {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)",
        )
        .run(SCHEMA_VERSION, Date.now());
    }
  }

  private storeRun(
    threadId: string,
    runId: string,
    events: BaseEvent[],
    input: RunAgentInput,
    parentRunId?: string | null,
  ): void {
    // Compact ONLY the events from this run
    const compactedEvents = compactEvents(events);

    const stmt = this.db.prepare(`
      INSERT INTO agent_runs (thread_id, run_id, parent_run_id, events, input, created_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      threadId,
      runId,
      parentRunId ?? null,
      JSON.stringify(compactedEvents), // Store only this run's compacted events
      JSON.stringify(input),
      Date.now(),
      SCHEMA_VERSION,
    );
  }

  private getHistoricRuns(threadId: string): AgentRunRecord[] {
    const stmt = this.db.prepare(`
      WITH RECURSIVE run_chain AS (
        -- Base case: find the root runs (those without parent)
        SELECT * FROM agent_runs 
        WHERE thread_id = ? AND parent_run_id IS NULL
        
        UNION ALL
        
        -- Recursive case: find children of current level
        SELECT ar.* FROM agent_runs ar
        INNER JOIN run_chain rc ON ar.parent_run_id = rc.run_id
        WHERE ar.thread_id = ?
      )
      SELECT * FROM run_chain
      ORDER BY created_at ASC
    `);

    const rows = stmt.all(threadId, threadId) as any[];

    return rows.map((row) => ({
      id: row.id,
      thread_id: row.thread_id,
      run_id: row.run_id,
      parent_run_id: row.parent_run_id,
      events: JSON.parse(row.events),
      input: JSON.parse(row.input),
      created_at: row.created_at,
      version: row.version,
    }));
  }

  private getLatestRunId(threadId: string): string | null {
    const stmt = this.db.prepare(`
      SELECT run_id FROM agent_runs 
      WHERE thread_id = ? 
      ORDER BY created_at DESC 
      LIMIT 1
    `);

    const result = stmt.get(threadId) as { run_id: string } | undefined;
    return result?.run_id ?? null;
  }

  private setRunState(
    threadId: string,
    isRunning: boolean,
    runId?: string,
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO run_state (thread_id, is_running, current_run_id, updated_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(threadId, isRunning ? 1 : 0, runId ?? null, Date.now());
  }

  private getRunState(threadId: string): {
    isRunning: boolean;
    currentRunId: string | null;
  } {
    const stmt = this.db.prepare(`
      SELECT is_running, current_run_id FROM run_state WHERE thread_id = ?
    `);
    const result = stmt.get(threadId) as
      | { is_running: number; current_run_id: string | null }
      | undefined;

    return {
      isRunning: result?.is_running === 1,
      currentRunId: result?.current_run_id ?? null,
    };
  }

  /**
   * Owner of a thread: the recorded owner, {@link LEGACY_THREAD_OWNER} for a
   * thread whose runs predate owner records, or `undefined` for an unknown
   * thread.
   *
   * The owner record and the run check are read by one statement, so they
   * come from one snapshot of the database. With two reads, another runner on
   * the same file could claim the thread and store its first run in between,
   * and this call would see runs but no owner and take that thread for a
   * legacy one, open to every caller.
   */
  private getThreadOwner(threadId: string): string | undefined {
    const row = this.db
      .prepare(
        "SELECT (SELECT owner_id FROM thread_owners WHERE thread_id = ?) AS owner_id, EXISTS (SELECT 1 FROM agent_runs WHERE thread_id = ?) AS has_runs",
      )
      .get(threadId, threadId) as
      | { owner_id: string | null; has_runs: number }
      | undefined;
    if (row?.owner_id != null) return row.owner_id;
    return row?.has_runs ? LEGACY_THREAD_OWNER : undefined;
  }

  /**
   * True when a call acting as `ownerId` may reach an existing thread: its
   * owner, or anyone for a legacy thread.
   */
  private isOwnedBy(threadId: string, ownerId: string | undefined): boolean {
    const owner = this.getThreadOwner(threadId);
    return (
      owner === LEGACY_THREAD_OWNER || owner === ɵresolveThreadOwner(ownerId)
    );
  }

  /**
   * False when the thread is held by an owner other than `scope`'s. A legacy
   * thread is held by nobody, so it is accessible to every caller.
   */
  isThreadAccessible(
    threadId: string,
    scope: LocalThreadEndpointScope,
  ): boolean {
    const owner = this.getThreadOwner(threadId);
    return (
      owner === undefined ||
      owner === LEGACY_THREAD_OWNER ||
      owner === ɵresolveThreadOwner(scope.ownerId)
    );
  }

  /**
   * Records `owner` as the owner of a new thread, and returns true when the
   * run may go on as `owner`: `owner` holds the thread afterward, or the
   * thread is legacy, which stays unowned. The read, the insert and the
   * re-read run in one IMMEDIATE transaction, so when two runners or
   * processes on one database file claim a new thread at once, exactly one
   * wins and the other reads the winner's row.
   */
  private claimThread(threadId: string, owner: string): boolean {
    return this.db
      .transaction(() => {
        const current = this.getThreadOwner(threadId);
        if (current === LEGACY_THREAD_OWNER) return true;
        if (current === undefined) {
          this.db
            .prepare(
              "INSERT INTO thread_owners (thread_id, owner_id, created_at) VALUES (?, ?, ?) ON CONFLICT(thread_id) DO NOTHING",
            )
            .run(threadId, owner, Date.now());
        }
        return this.getThreadOwner(threadId) === owner;
      })
      .immediate();
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    // A thread belongs to the identity of its first run.
    const owner = ɵresolveThreadOwner(request.ownerId);
    if (!this.isThreadAccessible(request.threadId, { ownerId: owner })) {
      throw new ThreadAccessDeniedError();
    }

    // Check if thread is already running in database
    const runState = this.getRunState(request.threadId);
    if (runState.isRunning) {
      throw new ThreadAlreadyRunningError();
    }

    // The check above is per process. Another process on the same database
    // file can claim the thread in between, so the claim itself decides.
    if (!this.claimThread(request.threadId, owner)) {
      throw new ThreadAccessDeniedError();
    }

    // Mark thread as running in database
    this.setRunState(request.threadId, true, request.input.runId);

    // Track seen message IDs and current run events in memory for this run
    const seenMessageIds = new Set<string>();
    const currentRunEvents: BaseEvent[] = [];

    // Get all previously seen message IDs from historic runs
    const historicRuns = this.getHistoricRuns(request.threadId);
    const historicMessageIds = new Set<string>();
    for (const run of historicRuns) {
      for (const event of run.events) {
        if ("messageId" in event && typeof event.messageId === "string") {
          historicMessageIds.add(event.messageId);
        }
        if (event.type === EventType.RUN_STARTED) {
          const runStarted = event as RunStartedEvent;
          const messages = runStarted.input?.messages ?? [];
          for (const message of messages) {
            historicMessageIds.add(message.id);
          }
        }
      }
    }

    // Get or create subject for this thread's connections
    const nextSubject = new ReplaySubject<BaseEvent>(Infinity);
    const prevConnection = this.activeConnections.get(request.threadId);
    const prevSubject = prevConnection?.subject;

    // Create a subject for run() return value
    const runSubject = new ReplaySubject<BaseEvent>(Infinity);

    // Update the active connection for this thread
    const runConnection: ActiveConnectionContext = {
      subject: nextSubject,
      agent: request.agent,
      runSubject,
      currentEvents: currentRunEvents,
      stopRequested: false,
    };
    this.activeConnections.set(request.threadId, runConnection);

    // Helper function to run the agent and handle errors
    const runAgent = async () => {
      // Get parent run ID for chaining
      const parentRunId = this.getLatestRunId(request.threadId);

      const ensureStoppedRunStarted = (stopRequested: boolean) => {
        if (
          !stopRequested ||
          currentRunEvents.some((event) => event.type === EventType.RUN_STARTED)
        ) {
          return;
        }
        // Stop can arrive before the agent sends its first event.
        const started: RunStartedEvent = {
          type: EventType.RUN_STARTED,
          threadId: request.threadId,
          runId: request.input.runId,
          input: {
            ...request.input,
            messages: request.input.messages.filter(
              (message) => !historicMessageIds.has(message.id),
            ),
          },
        };
        currentRunEvents.unshift(started);
        runSubject.next(started);
        nextSubject.next(started);
      };

      try {
        await request.agent.runAgent(request.input, {
          onEvent: ({ event }) => {
            let processedEvent: BaseEvent = event;
            if (event.type === EventType.RUN_STARTED) {
              const runStartedEvent = event as RunStartedEvent;
              if (!runStartedEvent.input) {
                const sanitizedMessages = request.input.messages
                  ? request.input.messages.filter(
                      (message) => !historicMessageIds.has(message.id),
                    )
                  : undefined;
                const updatedInput = {
                  ...request.input,
                  ...(sanitizedMessages !== undefined
                    ? { messages: sanitizedMessages }
                    : {}),
                };
                processedEvent = {
                  ...runStartedEvent,
                  input: updatedInput,
                } as RunStartedEvent;
              }
            }

            runSubject.next(processedEvent); // For run() return - only agent events
            nextSubject.next(processedEvent); // For connect() / store - all events
            currentRunEvents.push(processedEvent); // Accumulate for database storage
          },
          onNewMessage: ({ message }) => {
            // Called for each new message
            if (!seenMessageIds.has(message.id)) {
              seenMessageIds.add(message.id);
            }
          },
          onRunStartedEvent: () => {
            // Mark input messages as seen without emitting duplicates
            if (request.input.messages) {
              for (const message of request.input.messages) {
                if (!seenMessageIds.has(message.id)) {
                  seenMessageIds.add(message.id);
                }
              }
            }
          },
        });

        const connection = this.activeConnections.get(request.threadId);
        ensureStoppedRunStarted(connection?.stopRequested ?? false);
        const appendedEvents = finalizeRunEvents(currentRunEvents, {
          stopRequested: connection?.stopRequested ?? false,
          protocolVersion: request.input.protocolVersion,
        });
        for (const event of appendedEvents) {
          runSubject.next(event);
          nextSubject.next(event);
        }

        // Store the run in database
        this.storeRun(
          request.threadId,
          request.input.runId,
          currentRunEvents,
          request.input,
          parentRunId,
        );

        // Mark run as complete in database
        this.setRunState(request.threadId, false);

        if (connection) {
          connection.agent = undefined;
          connection.runSubject = undefined;
          connection.currentEvents = undefined;
          connection.stopRequested = false;
        }

        // Complete the subjects
        runSubject.complete();
        nextSubject.complete();

        this.activeConnections.delete(request.threadId);
      } catch (error) {
        const connection = this.activeConnections.get(request.threadId);
        if (!connection?.stopRequested) {
          console.error(
            "Sqlite agent run failed",
            { threadId: request.threadId, runId: request.input.runId },
            error,
          );
        }
        ensureStoppedRunStarted(connection?.stopRequested ?? false);
        const appendedEvents = finalizeRunEvents(currentRunEvents, {
          stopRequested: connection?.stopRequested ?? false,
          protocolVersion: request.input.protocolVersion,
        });
        for (const event of appendedEvents) {
          runSubject.next(event);
          nextSubject.next(event);
        }

        // Store the run even if it failed (partial events)
        if (currentRunEvents.length > 0) {
          this.storeRun(
            request.threadId,
            request.input.runId,
            currentRunEvents,
            request.input,
            parentRunId,
          );
        }

        // Mark run as complete in database
        this.setRunState(request.threadId, false);

        if (connection) {
          connection.agent = undefined;
          connection.runSubject = undefined;
          connection.currentEvents = undefined;
          connection.stopRequested = false;
        }

        // Don't emit error to the subject, just complete it
        // This allows subscribers to get events emitted before the error
        runSubject.complete();
        nextSubject.complete();

        this.activeConnections.delete(request.threadId);
      }
    };

    // Bridge previous events if they exist
    if (prevSubject) {
      prevSubject.subscribe({
        next: (e) => nextSubject.next(e),
        error: (err) => nextSubject.error(err),
        complete: () => {
          // Don't complete nextSubject here - it needs to stay open for new events
        },
      });
    }

    // Start the agent execution immediately (not lazily). A failure while
    // storing or finishing the run must not leave the thread marked running
    // in the database, where it would refuse every later run, even after a
    // restart.
    runAgent().catch((error) => {
      console.error(
        "Failed to finish sqlite agent run",
        { threadId: request.threadId, runId: request.input.runId },
        error,
      );
      try {
        const state = this.getRunState(request.threadId);
        if (
          state.currentRunId === null ||
          state.currentRunId === request.input.runId
        ) {
          this.setRunState(request.threadId, false);
        }
      } catch (stateError) {
        console.error("Failed to reset sqlite run state", stateError);
      }
      if (this.activeConnections.get(request.threadId) === runConnection) {
        this.activeConnections.delete(request.threadId);
      }
      runSubject.complete();
      nextSubject.complete();
    });

    // Return the run subject (only agent events, no injected messages)
    return runSubject.asObservable();
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const connectionSubject = new ReplaySubject<BaseEvent>(Infinity);

    // A thread owned by another identity replays like an unknown one.
    if (!this.isOwnedBy(request.threadId, request.ownerId)) {
      connectionSubject.complete();
      return connectionSubject.asObservable();
    }

    // Load historic runs from database
    const historicRuns = this.getHistoricRuns(request.threadId);

    // Collect all historic events from database
    const allHistoricEvents: BaseEvent[] = [];
    for (const run of historicRuns) {
      allHistoricEvents.push(...run.events);
    }

    // Compact all events together before emitting
    const compactedEvents = compactEvents(allHistoricEvents);

    // Emit compacted events and track message IDs
    const emittedMessageIds = new Set<string>();
    for (const event of compactedEvents) {
      connectionSubject.next(event);
      if ("messageId" in event && typeof event.messageId === "string") {
        emittedMessageIds.add(event.messageId);
      }
    }

    // Bridge active run to connection if exists
    const activeConnection = this.activeConnections.get(request.threadId);
    const runState = this.getRunState(request.threadId);

    if (
      activeConnection &&
      (runState.isRunning || activeConnection.stopRequested)
    ) {
      activeConnection.subject.subscribe({
        next: (event) => {
          // Skip message events that we've already emitted from historic
          if (
            "messageId" in event &&
            typeof event.messageId === "string" &&
            emittedMessageIds.has(event.messageId)
          ) {
            return;
          }
          connectionSubject.next(event);
        },
        complete: () => connectionSubject.complete(),
        error: (err) => connectionSubject.error(err),
      });
    } else {
      // No active run, complete after historic events
      connectionSubject.complete();
    }

    return connectionSubject.asObservable();
  }

  isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    // Another identity's thread reports "not running".
    if (!this.isOwnedBy(request.threadId, request.ownerId)) {
      return Promise.resolve(false);
    }
    const runState = this.getRunState(request.threadId);
    return Promise.resolve(runState.isRunning);
  }

  stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    const runState = this.getRunState(request.threadId);
    if (!runState.isRunning) {
      return Promise.resolve(false);
    }
    // A run on another identity's thread reports "no active run".
    if (!this.isOwnedBy(request.threadId, request.ownerId)) {
      return Promise.resolve(false);
    }
    // A run-scoped stop never stops a newer run on the thread.
    if (
      request.runId !== undefined &&
      runState.currentRunId !== request.runId
    ) {
      return Promise.resolve(false);
    }

    const connection = this.activeConnections.get(request.threadId);
    const agent = connection?.agent;

    if (!connection || !agent) {
      return Promise.resolve(false);
    }

    if (connection.stopRequested) {
      return Promise.resolve(false);
    }

    connection.stopRequested = true;
    this.setRunState(request.threadId, false);

    try {
      agent.abortRun();
      return Promise.resolve(true);
    } catch (error) {
      console.error("Failed to abort sqlite agent run", error);
      connection.stopRequested = false;
      // Restore the run's id too, or a later stop by run id would refuse it.
      this.setRunState(
        request.threadId,
        true,
        runState.currentRunId ?? undefined,
      );
      return Promise.resolve(false);
    }
  }

  /**
   * Close the database connection (for cleanup)
   */
  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}

import type { AbstractAgent, RunAgentResult } from "@ag-ui/client";

/**
 * Queue for serializing MCP app requests to an agent.
 * Ensures requests wait for the agent to stop running and are processed one at a time.
 */
export class MCPAppsRequestQueue {
  private queues = new Map<
    string,
    Array<{
      execute: () => Promise<RunAgentResult>;
      resolve: (result: RunAgentResult) => void;
      reject: (error: Error) => void;
    }>
  >();
  private processing = new Map<string, boolean>();

  /**
   * Add a request to the queue for a specific agent thread.
   * Returns a promise that resolves when the request completes.
   */
  async enqueue(
    agent: AbstractAgent,
    request: () => Promise<RunAgentResult>,
  ): Promise<RunAgentResult> {
    const threadId = agent.threadId || "default";

    return new Promise((resolve, reject) => {
      // Get or create queue for this thread
      let queue = this.queues.get(threadId);
      if (!queue) {
        queue = [];
        this.queues.set(threadId, queue);
      }

      // Add request to queue
      queue.push({ execute: request, resolve, reject });

      // Start processing if not already running
      this.processQueue(threadId, agent);
    });
  }

  private async processQueue(
    threadId: string,
    agent: AbstractAgent,
  ): Promise<void> {
    // If already processing this queue, return
    if (this.processing.get(threadId)) {
      return;
    }

    this.processing.set(threadId, true);

    try {
      const queue = this.queues.get(threadId);
      if (!queue) return;

      while (queue.length > 0) {
        const item = queue[0]!;

        try {
          // Wait for any active run to complete before processing
          await this.waitForAgentIdle(agent);

          // Execute the request
          const result = await item.execute();
          item.resolve(result);
        } catch (error) {
          item.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        }

        // Remove processed item
        queue.shift();
      }
    } finally {
      this.processing.set(threadId, false);
    }
  }

  private waitForAgentIdle(agent: AbstractAgent): Promise<void> {
    return new Promise((resolve) => {
      if (!agent.isRunning) {
        resolve();
        return;
      }

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearInterval(checkInterval);
        sub.unsubscribe();
        resolve();
      };

      const sub = agent.subscribe({
        onRunFinalized: finish,
        onRunFailed: finish,
      });

      // Fallback for reconnect scenarios where events don't fire
      const checkInterval = setInterval(() => {
        if (!agent.isRunning) finish();
      }, 500);
    });
  }
}

// Shared per-thread queue instance for all MCP app requests.
export const mcpAppsRequestQueue = new MCPAppsRequestQueue();

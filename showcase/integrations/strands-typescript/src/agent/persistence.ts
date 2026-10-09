import { join } from "node:path";
import { FileStorage, SessionManager } from "@strands-agents/sdk";
import { StrandsAgent } from "@ag-ui/aws-strands";

/** All Showcase agent factories use the same durable session policy. A separate
 * directory per mounted agent prevents two agents with the SDK's default ID
 * from overwriting each other's checkpoint on the same application thread.
 */
export class PersistentStrandsAgent extends StrandsAgent {
  constructor(options: ConstructorParameters<typeof StrandsAgent>[0]) {
    const directory = process.env.STRANDS_SESSION_DIRECTORY;
    super({
      ...options,
      config: {
        ...options.config,
        ...(directory && !options.config?.sessionManagerProvider
          ? {
              sessionManagerProvider: ({ threadId }: { threadId: string }) =>
                new SessionManager({
                  sessionId: threadId,
                  storage: {
                    snapshot: new FileStorage(join(directory, options.name)),
                  },
                }),
            }
          : {}),
      },
    });
  }
}

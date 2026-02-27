import type { AbstractAgent, BaseEvent, RunAgentInput } from "@ag-ui/client";
import { RunAgentInputSchema } from "@ag-ui/client";
import { BuiltInAgent } from "@copilotkitnext/agent";
import { createCopilotEndpointExpress } from "@copilotkitnext/runtime/express";
import { CopilotRuntime } from "@copilotkitnext/runtime";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { RealtimeStore } from "./realtime-store.js";

dotenv.config();

const BFF_PORT = Number(process.env.BFF_PORT ?? 4100);
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const GATEWAY_WS_URL =
  process.env.GATEWAY_WS_URL ?? "ws://localhost:4200/ws/websocket";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "openai/gpt-5.1";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({
      model: OPENAI_MODEL,
    }),
  },
});

const app = express();
app.use(cors());
app.use(express.json());

function parseRunInput(body: unknown) {
  return RunAgentInputSchema.parse(body);
}

async function getAgentOrThrow(agentId: string): Promise<AbstractAgent> {
  const agents = await runtime.agents;
  const registeredAgent = agents[agentId] as AbstractAgent | undefined;
  if (!registeredAgent) {
    throw new Error(`Agent '${agentId}' does not exist`);
  }
  return registeredAgent.clone() as AbstractAgent;
}

async function publishRunEvents(params: {
  store: RealtimeStore;
  token: string;
  threadId: string;
  agent: AbstractAgent;
  input: RunAgentInput;
  runId: string;
}) {
  const { store, token, threadId, agent, input, runId } = params;

  runtime.runner
    .run({
      threadId,
      agent,
      input,
    })
    .subscribe({
      next: async (event: BaseEvent) => {
        await store.appendTokenReplay(token, event);
        await store.appendThreadEvent(threadId, event);
      },
      error: async (error: unknown) => {
        const runError: BaseEvent = {
          type: "RUN_ERROR",
          message: error instanceof Error ? error.message : String(error),
        } as BaseEvent;
        await store.appendTokenReplay(token, runError);
        await store.appendThreadEvent(threadId, runError);
        await store.releaseThreadLock(threadId, runId);
      },
      complete: async () => {
        await store.releaseThreadLock(threadId, runId);
      },
    });
}

async function bootstrap() {
  const store = await RealtimeStore.create(REDIS_URL);

  app.post("/api/copilotkit/agent/:agentId/run-ws", async (req, res) => {
    try {
      const input = parseRunInput(req.body);
      const agentId = req.params.agentId;
      const runId = input.runId;

      const lockAcquired = await store.acquireThreadLock(input.threadId, runId);
      if (!lockAcquired) {
        res.status(409).json({
          error: "thread_locked",
          message: `Thread '${input.threadId}' is already running.`,
          threadId: input.threadId,
        });
        return;
      }

      const agent = await getAgentOrThrow(agentId);
      agent.setMessages(input.messages);
      agent.setState(input.state);
      agent.threadId = input.threadId;

      const tokenResponse = await store.issueToken({
        agentId,
        threadId: input.threadId,
      });

      res.status(200).json({
        ...tokenResponse,
        wsUrl: GATEWAY_WS_URL,
      });

      await publishRunEvents({
        store,
        token: tokenResponse.token,
        threadId: input.threadId,
        agent,
        input,
        runId,
      });
    } catch (error) {
      res.status(400).json({
        error: "invalid_request",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/copilotkit/agent/:agentId/connect-ws", async (req, res) => {
    try {
      const input = parseRunInput(req.body);
      const agentId = req.params.agentId;

      const replayEvents = await store.getThreadEvents(input.threadId);
      const tokenResponse = await store.issueToken({
        agentId,
        threadId: input.threadId,
        replayEvents,
      });

      res.status(200).json({
        ...tokenResponse,
        wsUrl: GATEWAY_WS_URL,
      });
    } catch (error) {
      res.status(400).json({
        error: "invalid_request",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post(
    "/api/copilotkit/agent/:agentId/stop/:threadId",
    async (req, res, next) => {
      try {
        const threadId = req.params.threadId;
        await runtime.runner.stop({ threadId });
        await store.releaseThreadLock(threadId);
        res.status(200).json({
          stopped: true,
          threadId,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.use(
    "/api/copilotkit",
    createCopilotEndpointExpress({
      runtime,
      basePath: "/",
    }),
  );

  const server = app.listen(BFF_PORT, () => {
    console.log(`Realtime BFF listening at http://localhost:${BFF_PORT}`);
  });

  const shutdown = async () => {
    server.close();
    await store.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void bootstrap();

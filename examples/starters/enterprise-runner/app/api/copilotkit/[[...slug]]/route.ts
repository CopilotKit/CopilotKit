import {
  CopilotRuntime,
  createCopilotEndpoint,
} from '@copilotkitnext/runtime';
import { BasicAgent } from "@copilotkitnext/agent";
import { EnterpriseAgentRunner, AgentDatabase } from '@copilotkitnext/enterprise-runner';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { handle } from "hono/vercel";

// Initialize Kysely with PostgreSQL
const db = new Kysely<AgentDatabase>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: process.env.ENTERPRISE_RUNNER_STORAGE_URL,
    }),
  }),
});

// Initialize Redis
const redis = new Redis(process.env.ENTERPRISE_RUNNER_REDIS_CACHE_URL || 'redis://localhost:6379');


const agent = new BasicAgent({
  model: "openai/gpt-5",
  prompt: "You are a helpful AI assistant.",
  temperature: 0.7,
})

const runtime = new CopilotRuntime({
  agents: {
    default: agent,
  },
  runner: new EnterpriseAgentRunner({
    kysely: db,
    redis: redis,
  }),
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);

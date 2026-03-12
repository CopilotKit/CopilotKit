# CopilotKit Enterprise Runtime

A Next.js application that provides an enterprise-grade AI agent runtime powered by CopilotKit's EnterpriseAgentRunner with persistent storage and distributed caching.

## Overview

This project integrates CopilotKit with the EnterpriseAgentRunner to provide:

- **Persistent Agent State** - PostgreSQL storage via Kysely ORM for durable agent runs and conversation history
- **Distributed Caching** - Redis-backed state management for multi-instance deployments
- **Enterprise-Grade Reliability** - Built-in support for agent state recovery, run management, and concurrent execution handling
- **AI-Powered Interactions** - OpenAI integration (gpt-5) for intelligent agent responses

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js Application                      │
│                     (React 19 + App Router)                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
                  ┌────────▼─────────┐
                  │ CopilotKit API   │
                  │ /api/copilotkit  │
                  └────────┬─────────┘
                           │
         ┌─────────────────┴─────────────────┐
         │                                   │
┌────────▼──────────┐            ┌──────────▼─────────┐
│ CopilotRuntime    │            │ OpenAI Adapter     │
│ + Enterprise      │            │ (gpt-5)            │
│   AgentRunner     │            └────────────────────┘
└────────┬──────────┘
         │
    ┌────┴─────┐
    │          │
┌───▼──────┐ ┌─▼────────┐
│PostgreSQL│ │  Redis   │
│ (Kysely) │ │ (ioredis)│
│ Agent    │ │ State &  │
│ Storage  │ │ Cache    │
└──────────┘ └──────────┘
```

## Technology Stack

### Core Framework
- **Next.js 16.0.1** - React framework with App Router
- **React 19.2.0** - UI library
- **TypeScript 5.x** - Type-safe development

### CopilotKit Integration
- **@copilotkit/runtime** `^1.10.6` - Core runtime for AI agents
- **@copilotkit/react-core** `^1.10.6` - React integration
- **@copilotkit/react-ui** `^1.10.6` - UI components
- **@copilotkitnext/enterprise-runner** - Enterprise agent runner with state management

### Data Layer
- **Kysely** `^0.28.5` - Type-safe SQL query builder
- **pg** `^8.13.1` - PostgreSQL client
- **ioredis** `^5.7.0` - Redis client with full TypeScript support

### Styling
- **Tailwind CSS 4** - Utility-first CSS framework
- **@tailwindcss/postcss** - PostCSS integration

## Prerequisites

- **Node.js** v20.x or higher
- **pnpm** v9.x or higher (recommended) or npm/yarn
- **PostgreSQL** 13+ (for agent state storage)
- **Redis** 6+ (for caching and distributed state)

## Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd copilotkit-enterprise-runtime
```

2. **Install dependencies**
```bash
pnpm install
```

3. **Set up environment variables**

Create a `.env.local` file in the root directory:

```env
# PostgreSQL Connection
ENTERPRISE_RUNNER_STORAGE_URL=postgresql://user:password@localhost:5432/copilotkit_agents

# Redis Connection
ENTERPRISE_RUNNER_REDIS_CACHE_URL=redis://localhost:6379

# OpenAI API Key (for gpt-5 model)
OPENAI_API_KEY=sk-...

# Optional: Development settings
PORT=3000
NODE_ENV=development
```

## Configuration

### Database Setup

The EnterpriseAgentRunner automatically creates the required database schema on first run:

**Tables Created:**
- `agent_runs` - Stores agent execution history and events
- `run_state` - Tracks active agent runs and their state
- `schema_version` - Manages database schema versioning

**Indexes:**
- `idx_thread_id` - Optimizes queries by thread ID
- `idx_parent_run_id` - Optimizes hierarchical run queries

No manual migrations needed! The runner handles schema initialization automatically.

### Redis Configuration

Redis is used for:
- **Active Run Tracking** - Monitors which agents are currently executing
- **Event Streaming** - Real-time event distribution across instances
- **Lock Management** - Prevents concurrent execution conflicts
- **State Synchronization** - Coordinates multi-instance deployments

Default configuration:
- Stream retention: 60 minutes
- Active TTL: 5 minutes
- Lock TTL: 5 minutes

## Development

### Running Locally

```bash
# Start the development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

The API endpoint will be available at: `http://localhost:3000/api/copilotkit`

### Development with Docker Compose

For local development with PostgreSQL and Redis:

```bash
# Start dependencies
docker compose up -d postgres redis

# Start the Next.js app
pnpm dev
```

### Project Structure

```
copilotkit-enterprise-runtime/
├── app/
│   ├── api/
│   │   └── copilotkit/
│   │       └── route.ts          # CopilotKit API endpoint
│   ├── layout.tsx                 # Root layout with CopilotKit provider
│   ├── page.tsx                   # Home page
│   └── favicon.ico
├── public/                        # Static assets
├── .env.local                     # Environment variables (create this)
├── package.json                   # Dependencies and scripts
├── tsconfig.json                  # TypeScript configuration
├── tailwind.config.ts             # Tailwind CSS configuration
├── next.config.ts                 # Next.js configuration
└── README.md                      # This file
```

### Key Files

#### `/app/api/copilotkit/route.ts`

The main API endpoint that:
1. Initializes Kysely with PostgreSQL connection
2. Creates Redis client for caching
3. Configures OpenAI adapter with gpt-5 model
4. Sets up CopilotRuntime with EnterpriseAgentRunner
5. Exports POST handler for agent requests

#### `/app/layout.tsx`

Root layout that wraps the application with CopilotKit providers.

## Available Scripts

```bash
# Development
pnpm dev           # Start development server (with hot reload)

# Production
pnpm build         # Build for production
pnpm start         # Start production server

# Code Quality
pnpm lint          # Run ESLint
pnpm type-check    # Run TypeScript type checking

# Testing
pnpm test          # Run tests (if configured)
```

## API Endpoints

### POST `/api/copilotkit`

The main CopilotKit endpoint for agent interactions.

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "threadId": "thread-123",
  "messages": [
    {
      "role": "user",
      "content": "Hello, I need help with..."
    }
  ]
}
```

**Response:**
Streaming response with agent events and messages.

## Deployment

### Environment Variables (Production)

Ensure these are set in your production environment:

```env
ENTERPRISE_RUNNER_STORAGE_URL=postgresql://user:password@prod-db.example.com:5432/copilotkit
ENTERPRISE_RUNNER_REDIS_CACHE_URL=redis://prod-redis.example.com:6379
OPENAI_API_KEY=sk-prod-...
NODE_ENV=production
```

### Docker Deployment

Build the Docker image:

```bash
docker build -t copilotkit-enterprise-runtime:latest .
```

Run the container:

```bash
docker run -p 3000:3000 \
  -e ENTERPRISE_RUNNER_STORAGE_URL=$DATABASE_URL \
  -e ENTERPRISE_RUNNER_REDIS_CACHE_URL=$REDIS_URL \
  -e OPENAI_API_KEY=$OPENAI_KEY \
  copilotkit-enterprise-runtime:latest
```

### Kubernetes Deployment

The application is designed to work in distributed environments:

- Multiple instances can run concurrently
- Redis coordinates state across instances
- PostgreSQL provides persistent storage
- Health checks can monitor `/api/copilotkit` endpoint

### Vercel Deployment

The easiest way to deploy is using [Vercel](https://vercel.com):

1. Push your code to GitHub
2. Import the project in Vercel
3. Add environment variables in Vercel dashboard
4. Deploy!

**Note:** Ensure your PostgreSQL and Redis instances are accessible from Vercel's deployment regions.

## Monitoring and Observability

### Health Checks

Monitor the health of your deployment:

```bash
# Check if the API is responding
curl -X POST http://localhost:3000/api/copilotkit \
  -H "Content-Type: application/json" \
  -d '{"threadId":"health-check"}'
```

### Database Monitoring

Monitor PostgreSQL for:
- Active agent runs in `run_state` table
- Storage growth in `agent_runs` table
- Query performance on indexed columns

### Redis Monitoring

Monitor Redis for:
- Active connections
- Memory usage (stream retention)
- Key expiration patterns

## Troubleshooting

### Database Connection Issues

**Error:** `Connection refused` or `Connection timeout`

**Solutions:**
1. Verify PostgreSQL is running: `psql $ENTERPRISE_RUNNER_STORAGE_URL`
2. Check firewall rules allow connections
3. Verify connection string format: `postgresql://user:password@host:port/database`

### Redis Connection Issues

**Error:** `ECONNREFUSED` or `Redis connection timeout`

**Solutions:**
1. Verify Redis is running: `redis-cli -u $ENTERPRISE_RUNNER_REDIS_CACHE_URL ping`
2. Check if Redis requires authentication
3. Verify network connectivity

### Agent Execution Errors

**Error:** `Thread already running`

**Cause:** Another instance or previous run didn't clean up properly.

**Solutions:**
1. Check Redis for active locks: `redis-cli keys "lock:*"`
2. Clear stale locks if needed: `redis-cli del "lock:thread-id"`
3. Verify the server ID is unique across instances

### Performance Issues

**Slow Agent Responses:**

1. Check PostgreSQL query performance
2. Monitor Redis memory usage
3. Review OpenAI API latency
4. Consider increasing timeout values

## Development Tips

### Local Database Setup

Quick PostgreSQL setup with Docker:

```bash
docker run --name copilotkit-postgres \
  -e POSTGRES_DB=copilotkit_agents \
  -e POSTGRES_USER=copilot \
  -e POSTGRES_PASSWORD=dev_password \
  -p 5432:5432 \
  -d postgres:17
```

### Local Redis Setup

Quick Redis setup with Docker:

```bash
docker run --name copilotkit-redis \
  -p 6379:6379 \
  -d redis:latest
```

### Debugging

Enable verbose logging:

```typescript
// In app/api/copilotkit/route.ts
const runtime = new CopilotRuntime({
  runner: new EnterpriseAgentRunner({
    kysely: db,
    redis: redis,
  }),
  // Add logging configuration
});
```

## Learn More

### CopilotKit Resources
- [CopilotKit Documentation](https://docs.copilotkit.ai)
- [CopilotKit GitHub](https://github.com/CopilotKit/CopilotKit)

### Next.js Resources
- [Next.js Documentation](https://nextjs.org/docs)
- [Next.js App Router](https://nextjs.org/docs/app)

### Database Resources
- [Kysely Documentation](https://kysely.dev/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Redis Documentation](https://redis.io/docs/)

## License

Private enterprise project - All rights reserved

## Support

For issues or questions, contact the platform team or open an issue in the repository.

---

**Version**: 0.1.0  
**Last Updated**: October 30, 2025  
**Maintained by**: CopilotKit Enterprise Team

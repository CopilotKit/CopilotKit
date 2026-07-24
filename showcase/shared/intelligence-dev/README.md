# CopilotKit Intelligence Local Development Setup

This directory provides a shared docker-compose template for running CopilotKit Intelligence locally during development.

## What's Included

- **PostgreSQL with pgvector** - Initialized with `intelligence_app` and `intelligence_app_shadow` databases
- **Redis** - For session management and realtime fan-out
- **Intelligence service** - Composite image with app-api and realtime-gateway

## Prerequisites

1. **Docker Desktop** or equivalent container runtime
2. **CopilotKit License Token** - Required for Intelligence features (get from [CopilotKit Cloud](https://cloud.copilotkit.ai))
3. **Intelligence Repository** (optional) - For building the intelligence image locally. Defaults to `../../../Intelligence` relative to the CopilotKit repo.

## Quick Start

### Option 1: From an Integration Example

From any integration example directory (e.g., `examples/integrations/mastra`):

```bash
# 1. Set your license token
echo "COPILOTKIT_LICENSE_TOKEN=your-token-here" >> .env

# 2. Start intelligence stack
docker compose -f ../../showcase/shared/intelligence-dev/docker-compose.yml up -d

# 3. Verify services are healthy
docker compose -f ../../showcase/shared/intelligence-dev/docker-compose.yml ps

# 4. Run your application (in a separate terminal)
npm run dev
```

### Option 2: Standalone

From this directory:

```bash
# 1. Set required environment variables
export COPILOTKIT_LICENSE_TOKEN=your-token-here
export INTELLIGENCE_REPO=/path/to/Intelligence  # Optional, defaults to ../../../Intelligence

# 2. Start the stack
docker compose up -d

# 3. Verify services
docker compose ps
```

## Services and Ports

| Service      | Internal Port | Default Host Port | Description                                       |
| ------------ | ------------- | ----------------- | ------------------------------------------------- |
| postgres     | 5432          | 5432              | PostgreSQL with pgvector                          |
| redis        | 6379          | 6379              | Redis for session/realtime                        |
| intelligence | 4201          | 4201              | Intelligence API (`/api/health`, `/api/memories`) |
| intelligence | 4401          | 4401              | Intelligence Gateway (WebSocket)                  |

## Environment Variables

Set these in `.env` or export them before running `docker compose up`:

- `COPILOTKIT_LICENSE_TOKEN` - **Required**. Your CopilotKit license token
- `INTELLIGENCE_REPO` - Path to Intelligence repo (default: `../../../Intelligence`)
- `POSTGRES_HOST_PORT` - Postgres host port (default: `5432`)
- `REDIS_HOST_PORT` - Redis host port (default: `6379`)
- `APP_API_HOST_PORT` - Intelligence API host port (default: `4201`)
- `GATEWAY_HOST_PORT` - Intelligence Gateway host port (default: `4401`)

## Application Configuration

Once the intelligence stack is running, configure your application's `.env`:

```bash
COPILOTKIT_LICENSE_TOKEN=your-token-here
INTELLIGENCE_API_URL=http://localhost:4201
INTELLIGENCE_GATEWAY_WS_URL=ws://localhost:4401
INTELLIGENCE_API_KEY=  # Optional, for additional auth
```

## Troubleshooting

### Container Unhealthy: database "intelligence_app" does not exist

This error means the postgres init script didn't run. This template includes the init script at `./docker/01-create-databases.sql` which creates the required databases on first boot.

**Solution:**

```bash
# Stop and remove volumes
docker compose -f ../../showcase/shared/intelligence-dev/docker-compose.yml down -v

# Start fresh (init script will run on first boot)
docker compose -f ../../showcase/shared/intelligence-dev/docker-compose.yml up -d
```

### Port Already in Use

If you have another intelligence instance running, you'll see port conflict errors.

**Solution:**

```bash
# Find processes using the ports
lsof -i :4201
lsof -i :4401
lsof -i :5432
lsof -i :6379

# Stop the existing intelligence stack
docker compose -f ../../showcase/shared/intelligence-dev/docker-compose.yml down

# Or use different ports
export APP_API_HOST_PORT=5201
export GATEWAY_HOST_PORT=5401
export POSTGRES_HOST_PORT=6432
export REDIS_HOST_PORT=7379
docker compose -f ../../showcase/shared/intelligence-dev/docker-compose.yml up -d
```

### Intelligence Image Build Fails

The intelligence service requires the Intelligence repo to build.

**Solution:**

```bash
# Option 1: Set path to your Intelligence checkout
export INTELLIGENCE_REPO=/path/to/your/Intelligence
docker compose -f ../../showcase/shared/intelligence-dev/docker-compose.yml up -d --build

# Option 2: Use a pre-built image (if available from registry)
# Edit docker-compose.yml and change the intelligence service:
#   intelligence:
#     image: ghcr.io/copilotkit/intelligence:latest  # Use published image
#     # Remove the build: section
```

## Stopping the Stack

```bash
# Stop services (keeps volumes/data)
docker compose -f ../../showcase/shared/intelligence-dev/docker-compose.yml stop

# Stop and remove containers (keeps volumes/data)
docker compose -f ../../showcase/shared/intelligence-dev/docker-compose.yml down

# Stop, remove containers AND volumes (fresh start next time)
docker compose -f ../../showcase/shared/intelligence-dev/docker-compose.yml down -v
```

## See Also

- [Banking Showcase](../../examples/showcases/banking/) - Full-featured example with memory-enabled intelligence
- [CopilotKit Intelligence Documentation](https://docs.copilotkit.ai/intelligence)
- [Integration Examples](../../examples/integrations/) - Framework-specific starter templates

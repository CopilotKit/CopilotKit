# Angular Demo Server

Minimal Hono server for the Angular CopilotKit demo, matching the React demo behavior.

## Setup

1. Add your OpenAI API key to `.env`:

   ```
   OPENAI_API_KEY=sk-...
   ```

2. Install dependencies (from repository root):

   ```bash
   pnpm install
   ```

3. Start the server:
   ```bash
   pnpm --filter @copilotkitnext/angular-demo-server dev
   ```

The server will be available at http://localhost:3001/api/copilotkit

## Testing

To verify the server is running:

```bash
curl http://localhost:3001/api/copilotkit/info
```

You should see JSON with agents and version information.

## Using with Angular Storybook

1. Start the demo server (Terminal A):

   ```bash
   pnpm --filter @copilotkitnext/angular-demo-server dev
   ```

2. Start Angular Storybook (Terminal B):

   ```bash
   pnpm --filter storybook-angular dev
   ```

3. Open http://localhost:6007 and navigate to "Live/CopilotChat"

# CopilotKit <> MCP Apps Starter

This is a starter template for integrating [MCP Apps](https://mcpui.dev) with [CopilotKit](https://copilotkit.ai). It uses the [Three.js example](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/threejs-server) from the official Model Context Protocol organization on GitHub.

https://github.com/user-attachments/assets/8908af31-2b64-4426-9c83-c51ab86256de

## Project Structure

```
.
├── app/                   # Next.js App Router pages and API routes
│   ├── page.tsx           # Main page
│   └── api/copilotkit/    # CopilotKit API route
├── threejs-server/        # MCP App Server (Three.js)
│   ├── server.ts          # Server entry point
│   ├── src/               # Three.js app source
│   └── package.json
├── scripts/               # MCP server run scripts
├── next.config.ts
├── tsconfig.json
└── package.json
```

## Prerequisites

- Node.js 20+
- Any of the following package managers:
  - npm (default)
  - [pnpm](https://pnpm.io/installation)
  - [yarn](https://classic.yarnpkg.com/lang/en/docs/install/)
  - [bun](https://bun.sh/)
- OpenAI API Key

## Getting Started

1. Install dependencies using your preferred package manager:

```bash
# Using npm (default)
npm install

# Using pnpm
pnpm install

# Using yarn
yarn install

# Using bun
bun install
```

> The `postinstall` script automatically installs the MCP server dependencies in `threejs-server/`.

2. Set up your environment variables:

```bash
echo 'OPENAI_API_KEY=your-openai-api-key-here' > .env
```

3. Start the development servers:

```bash
# Using npm (default)
npm run dev

# Using pnpm
pnpm dev

# Using yarn
yarn dev

# Using bun
bun run dev
```

This starts both the Next.js app and the MCP server concurrently.

## Available Scripts

The following scripts can also be run using your preferred package manager:

- `dev` - Starts both the UI and MCP server in development mode
- `dev:ui` - Starts only the Next.js UI server
- `dev:mcp` - Starts only the MCP App Server
- `build` - Builds the Next.js application for production
- `start` - Starts the production server

## Customization

The main UI component is in `app/page.tsx`. You can:

- Modify the theme colors and styling
- Add new frontend actions
- Customize the CopilotKit sidebar appearance

The MCP App Server code is in `threejs-server/`.

## Documentation

- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API
- [MCP Apps Documentation](https://mcpui.dev/guide/introduction) - Learn more about MCP Apps and how to use it

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

# CopilotKit <> MCP Apps Starter

This repository demonstrates how to integrate MCP Apps with CopilotKit. It uses the [Three.js example](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/threejs-server) from the official Model Context Protocol organization on GitHub.


https://github.com/user-attachments/assets/8908af31-2b64-4426-9c83-c51ab86256de


## Prerequisites

- Node.js 20+ 
- [pnpm](https://pnpm.io/installation) (recommended)
- OpenAI API Key

> **Note:** This repository ignores lock files (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to avoid conflicts between different package managers. Each developer should generate their own lock file using their preferred package manager. After that, make sure to delete it from the .gitignore.

## Getting Started

1. Install dependencies:
```bash
pnpm i
```

2. Set up your OpenAI API key:
```bash
echo 'OPENAI_API_KEY=your-openai-api-key-here' > .env
```

3. Start the MCP Apps server:
```bash
# Using pnpm
cd src/threejs-server
pnpm i
pnpm start
```

4. Start the development server:
```bash
# Using pnpm
pnpm dev

# Using npm
npm run dev

# Using yarn
yarn dev

# Using bun
bun run dev
```

## Available Scripts
The following scripts can also be run using your preferred package manager:
- `dev` - Starts both UI and agent servers in development mode
- `build` - Builds the Next.js application for production
- `start` - Starts the production server
- `lint` - Runs ESLint for code linting

## Documentation

The main UI component is in `src/app/page.tsx`. You can:
- Modify the theme colors and styling
- Add new frontend actions
- Customize the CopilotKit sidebar appearance

## 📚 Documentation

- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API
- [MCP Apps Documentation](https://mcpui.dev/guide/introduction) - Learn more about MCP Apps and how to use it

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

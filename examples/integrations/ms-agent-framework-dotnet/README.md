# CopilotKit <> Microsoft Agent Framework Starter

This is a starter template for building AI agents using [Microsoft Agent Framework](https://github.com/microsoft/agents) and [CopilotKit](https://copilotkit.ai). It provides a modern Next.js application with an integrated proverbs management agent that demonstrates AG-UI protocol features including shared state, generative UI, and human-in-the-loop workflows.

## Prerequisites

- **GitHub Personal Access Token** (for GitHub Models API)
  - Retrieve from GitHub using [these instructions](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-personal-access-token-classic).
  - or generate via `gh auth token` in your CLI (requires [GitHub CLI](https://github.com/cli/cli?tab=readme-ov-file#installation))
- **.NET 9.0 SDK**
  - [Download directly](https://dotnet.microsoft.com/download/dotnet/9.0)
  - macOS/Linux
    - [Install via Homebrew](https://formulae.brew.sh/formula/dotnet) (`brew install dotnet@9`) or
    - <details><summary>Install via <code>curl</code> install script</summary><br />

      ```bash
      curl -sSL https://dot.net/v1/dotnet-install.sh | bash /dev/stdin --channel 9.0
      export PATH="$HOME/.dotnet:$PATH"
      ```

      </details>
  - Windows
    - [Install via WinGet](https://winstall.app/apps/Microsoft.DotNet.SDK.9) (`winget install --id=Microsoft.DotNet.SDK.9 -e`)
- **Node.js 20+**
  - [Download directly](https://nodejs.org/en/download)
  - macOS/Linux
    - [Install via Homebrew](https://formulae.brew.sh/formula/node@24) (`brew install node@24`) or
    - <details><summary>Install via <code>curl</code> install script</summary><br />

      ```bash
      # Download and install nvm:
      curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

      # in lieu of restarting the shell
      \. "$HOME/.nvm/nvm.sh"

      # Download and install Node.js:
      nvm install 24
      ```

      </details>
  - Windows
    - [Install via WinGet](https://winstall.app/apps/OpenJS.NodeJS) (`winget install --id=OpenJS.NodeJS -v "24.11.0" -e`)
- Any of the following package managers:
  - [pnpm](https://pnpm.io/installation) **(recommended)**
  - [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) (usually installed with Node.js)
  - [yarn](https://yarnpkg.com/getting-started/install)
  - [bun](https://bun.com/docs/installation)

> **Note:** This repository ignores lock files (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to avoid conflicts between different package managers. Each developer should generate their own lock file using their preferred package manager. After that, make sure to delete it from the .gitignore.

## Getting Started

1. Install dependencies using your preferred package manager:

    ```bash
    # Using pnpm (recommended)
    pnpm install

    # Using npm
    npm install

    # Using yarn
    yarn install

    # Using bun
    bun install
    ```

    > **Note:** This will automatically setup the C# agent as well (restore NuGet packages).
    >
    > If you have manual issues, you can run:
    >
    > ```sh
    > npm run install:agent
    > ```

2. Set up your GitHub token for GitHub Models:

    First, get your GitHub token:
    ```bash
    gh auth token
    ```

    Then, navigate to the agent directory and set it as a user secret:
    ```bash
    cd agent
    dotnet user-secrets set GitHubToken "<your-token>"
    cd ..
    ```

    Or set it in one command:
    ```bash
    cd agent; dotnet user-secrets set GitHubToken "$(gh auth token)"; cd ..
    ```


3. Start the development server:

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

    This will start both the Next.js UI (port 3000) and C# agent server (port 8000) concurrently.

## Available Scripts
The following scripts can also be run using your preferred package manager:
- `dev` - Starts both UI and agent servers in development mode
- `dev:debug` - Starts development servers with debug logging enabled
- `dev:ui` - Starts only the Next.js UI server
- `dev:agent` - Starts only the C# agent server
- `build` - Builds the Next.js application for production
- `start` - Starts the production server
- `lint` - Runs ESLint for code linting
- `install:agent` - Restores NuGet packages for the C# agent

## Project Structure

```
├── agent/                  # C# Agent (Microsoft Agent Framework)
│   ├── Program.cs         # Main agent implementation with tools
│   ├── ProverbsAgent.csproj  # .NET project file
│   └── Properties/        # Configuration (launch settings)
├── src/
│   ├── app/
│   │   ├── page.tsx      # Main UI with CopilotKit sidebar
│   │   ├── layout.tsx    # CopilotKit provider setup
│   │   └── api/
│   │       └── copilotkit/
│   │           └── route.ts  # AG-UI integration endpoint
│   ├── components/       # UI components (weather, proverbs, moon)
│   └── lib/             # Types and utilities
└── scripts/             # Helper scripts for agent setup/run
```

## Features Demonstrated

This starter showcases key AG-UI protocol features:

- **🔄 Shared State**: Proverbs list synchronized between frontend and agent
- **🎨 Generative UI**: Weather card rendered from backend tool
- **👤 Human-in-the-Loop**: Moon card with approval workflow
- **🛠️ Frontend Actions**: Theme color changes from agent
- **💬 Agentic Chat**: Natural language interface with tool calling

## 📚 Documentation

- [Microsoft Agent Framework](https://github.com/microsoft/agents) - Learn about Microsoft's agent framework
- [AG-UI Protocol](https://github.com/copilotkit/ag-ui) - AG-UI protocol specification
- [CopilotKit Documentation](https://docs.copilotkit.ai) - CopilotKit features and API
- [Next.js Documentation](https://nextjs.org/docs) - Next.js features and API
- [GitHub Models](https://github.com/marketplace/models) - Free AI models via GitHub

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

### Agent Connection Issues
If you see "I'm having trouble connecting to my tools", make sure:
1. The C# agent is running on port 8000
2. Your GitHub token is set correctly via user secrets
3. Both servers started successfully (check terminal output)

### .NET SDK Not Installed
If you don't have .NET 9.0 installed:

**macOS/Linux (Homebrew):**
```bash
brew install dotnet@9
dotnet --version
```

**macOS/Linux (Install Script):**
```bash
curl -sSL https://dot.net/v1/dotnet-install.sh | bash /dev/stdin --channel 9.0
export PATH="$HOME/.dotnet:$PATH"
```

**Windows (WinGet):**
```powershell
winget install --id=Microsoft.DotNet.SDK.9 -e
```

**Windows/macOS (Direct Download):**
- Visit https://dotnet.microsoft.com/download/dotnet/9.0
- Download and run the installer

### .NET SDK Issues
If you encounter .NET-related errors:
```bash
# Verify .NET SDK is installed
dotnet --version  # Should be 9.0.x or higher

# Restore packages manually
cd agent
dotnet restore
dotnet run
```

### GitHub Token Issues
If the agent fails to start with "GitHubToken not found":
```bash
cd agent
dotnet user-secrets set GitHubToken "$(gh auth token)"
```

Or manually:
```bash
# Get your token
gh auth token

# Set it as a user secret
cd agent
dotnet user-secrets set GitHubToken "YOUR_TOKEN_HERE"
```

### Port Conflicts
If port 8000 is already in use, you can change it in:
- `agent/Properties/launchSettings.json` - Update `applicationUrl`
- `src/app/api/copilotkit/route.ts` - Update the HttpAgent URL
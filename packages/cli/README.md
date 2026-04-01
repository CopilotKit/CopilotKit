# 🪁 CopilotKit CLI

> **NOTE:** The CopilotKit CLI is an optional tool that enhances the developer experience of CopilotKit. [It is not required to use CopilotKit. Click here to get started with CopilotKit](https://docs.copilotkit.ai)..

[![Version](https://img.shields.io/npm/v/copilotkit.svg)](https://npmjs.org/package/copilotkit)
[![Downloads/week](https://img.shields.io/npm/dw/copilotkit.svg)](https://npmjs.org/package/copilotkit)

- [Installation](#installation)
- [Commands](#commands)
  - [init](#init-add-copilotkit-to-your-nextjs-project)
  - [login](#login-authenticating-with-copilot-cloud)
  - [dev](#dev-local-endpoint-development)
- [Need help?](#need-help)

## What is the CopilotKit CLI?

The CopilotKit CLI boosts your [CopilotKit](https://github.com/copilotkit/copilotkit) development experience. It integrates neatly with Copilot Cloud.

## Installation

```sh
# npm
npm install -g copilotkit

# pnpm
pnpm install -g copilotkit

# yarn
yarn global add copilotkit
```

## Commands

### `init`: Add CopilotKit to your Next.js project

The fastest way to add CopilotKit to your Next.js project is with the init command:

```sh
# Navigate to your Next.js project
cd my-nextjs-app

# Run the init command
copilotkit init
```

This interactive command will:

- Set up the required UI components
- Configure AI agents if desired (LangGraph, CrewAI)
- Connect to Copilot Cloud (optional)
- Create all necessary configuration files

You can also pass flags to automate the setup:

```sh
copilotkit init --mode LangGraph
```

### `login`: Authenticating with Copilot Cloud

First, ensure you have an account on [Copilot Cloud](https://cloud.copilotkit.ai).

Then, run the following command to authenticate with Copilot Cloud:

```sh
copilotkit login
```

### `dev`: Local Endpoint Development

The CopilotKit CLI allows you to create a local tunnel to your CopilotKit remote endpoints, agents, and LangGraph apps.

For example, to create a local tunnel to an endpoint running locally on port 8000, you can run:

```sh
copilotkit dev --port 8000
```

## Need help?

You can always run `copilotkit --help` to get help on the CopilotKit CLI.

You're welcome to join our [Discord](https://discord.gg/copilotkit) to get help from the CopilotKit team and community.

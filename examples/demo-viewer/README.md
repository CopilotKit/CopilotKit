# CopilotKit Demo Viewer

A modern, interactive viewer for exploring CopilotKit agent demos with a clean, responsive UI and dark/light theme support.

## Overview

The Demo Viewer provides a centralized interface for browsing, viewing, and exploring the source code of various CopilotKit agent demos. It features:

- Clean, modern UI with dark/light theme support
- Interactive demo previews
- Source code exploration with syntax highlighting
- Organized demo listing with tags and descriptions
- LLM provider selection

## Development Setup

To run the Demo Viewer locally for development, follow these steps:

### 1. Set up the agents

First, navigate to the agents directory and install dependencies:

```bash
cd agent
poetry install
```

Then start the agents server:

```bash
poetry run server
```

This will start the backend server that powers the agent demos.

### 2. Run the Demo Viewer

In a new terminal, navigate to the project root and start the Demo Viewer:

```bash
pnpm install
pnpm run dev
```

The Demo Viewer should now be running at [http://localhost:3000](http://localhost:3000).

## Adding a New Demo

To add a new demo to the viewer, follow these steps:

### 1. Create the demo files

Create a new folder for your demo inside the `agents/demo` directory:

```
agents/demo/your-demo-name/
```

Inside this folder, add the following files:

#### Python Files (Backend)
- `__init__.py` - An empty file required for Python package imports
- `agent.py` - The main Python file for your agent implementation
- Any additional Python modules your agent needs to import

#### Frontend Files
- `page.tsx` - The main React component for your demo
- Any additional styles or components needed

The `agent.py` file is particularly important as it's the entry point for your agent's functionality. Make sure it follows the agent implementation pattern used in other demos.

### 2. Register your agent in server.py

You need to register your agent in the `server.py` file so it can be discovered and used by the server:

1. Open `agent/server.py`
2. Look at how existing demos are registered in the file
3. Follow the same pattern to register your new agent
4. Make sure to use the correct import path and route that matches your demo's ID

This step is crucial for making your agent accessible through the API. Check existing implementations in the server.py file for the exact syntax and pattern to follow.

### 3. Update the configuration

Open `src/demos/config.ts` and add your demo to the configuration array:

```typescript
{
  id: "your-demo-name", // Must match the folder name in agents/demo
  name: "Your Demo Name",
  description: "A brief description of what your demo does",
  path: "agents/demo/your-demo-name",
  tags: ["tag1", "tag2"], // Relevant tags for categorization
  defaultLLMProvider: "openai" // Default LLM provider for this demo
}
```

Important notes:
- The `id` must correspond to the folder name inside `agents/demo`
- Ensure the `path` correctly points to your demo folder
- Add relevant tags to help users find your demo
- Set an appropriate default LLM provider

### 4. Test your demo

Run the Demo Viewer as described in the Development Setup section and verify that your demo appears in the list and functions correctly.

## Project Structure

- `src/app` - Next.js app router files
- `src/components` - Reusable UI components
- `src/demos` - Demo configuration and utilities
- `src/hooks` - Custom React hooks
- `src/types` - TypeScript type definitions
- `public` - Static assets

## Technologies

- Next.js
- React
- TypeScript
- Tailwind CSS
- CopilotKit 
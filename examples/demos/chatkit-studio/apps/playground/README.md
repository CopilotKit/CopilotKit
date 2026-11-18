# CopilotKit Chat Playground

A visual playground for customizing CopilotKit chat components. Adjust colors, fonts, and text, then export production-ready code.

![Demo Gif](docs/demo.gif)

## Overview

This tool lets you customize CopilotKit chat appearance with a live preview and export the code when you're done. Useful for designers and developers who want to integrate AI chat into their applications.

## Getting Started

### Prerequisites

- Node.js 18+
- npm, pnpm, yarn, or bun
- OpenAI API key (for the live preview agent)

### Installation

```bash
npm install
```

The postinstall script sets up the Python agent automatically.

### Running Locally

```bash
npm run dev
```

This starts the UI on `localhost:3000` and the agent on `localhost:8123`. Open your browser to `http://localhost:3000`.

## How It Works

1. Adjust settings in the left panel (colors, fonts, text, spacing)
2. See changes in real-time in the center preview
3. Click "Export Code" when finished
4. Copy the generated files into your project

The export includes:

- `MyChat.tsx` - Your customized chat component
- `layout.tsx` - CopilotKit wrapper
- `route.ts` - API route
- `.env.local` - Environment variables template

## Available Scripts

- `npm run dev` - Start UI and agent
- `npm run dev:ui` - Start UI only
- `npm run dev:agent` - Start agent only
- `npm run build` - Build for production
- `npm run start` - Run production build

## Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Main playground
│   ├── layout.tsx                  # Root layout
│   ├── preview/                    # Preview iframe
│   └── api/copilotkit-preview/     # Preview API
├── components/
│   ├── playground/
│   │   ├── PlaygroundContainer.tsx
│   │   ├── SettingsPanel.tsx
│   │   ├── PreviewPanel.tsx
│   │   ├── CodeExporter.tsx
│   │   └── AgentSetupModal.tsx
│   └── ui/                         # shadcn/ui components
├── hooks/
│   └── usePlaygroundConfig.ts
├── types/
│   └── playground.ts
└── utils/
    └── codeGenerator.ts

agent/
├── agent.py
├── langgraph.json
├── requirements.txt
└── .env
```

## Troubleshooting

### Preview not loading

The preview needs the agent running. Check:

- Agent is running on port 8123
- OpenAI API key is set in `agent/.env`
- No console errors in browser

### Agent won't start

Reinstall Python dependencies:

```bash
cd agent
rm -rf .venv
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Module not found

Reinstall node dependencies:

```bash
rm -rf node_modules package-lock.json
npm install
```

### Port in use

Kill the process or use a different port:

```bash
lsof -ti:3000 | xargs kill
# or
PORT=3001 npm run dev:ui
```

## Documentation

- [CopilotKit](https://docs.copilotkit.ai)
- [LangGraph](https://langchain-ai.github.io/langgraph/)
- [Architecture Details](./PLAYGROUND.md)

## License

MIT

Demo built by Mark Morgan in collaboration with CopilotKit Team.
Mark Morgan LinkedIn: https://www.linkedin.com/in/markmdev/

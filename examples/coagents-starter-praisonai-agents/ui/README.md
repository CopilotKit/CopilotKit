# PraisonAI Research Assistant UI

This is a [Next.js](https://nextjs.org/) project that provides a web interface for the PraisonAI Research Assistant.

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

Create a `.env` file in this directory with your API keys:

```bash
OPENAI_API_KEY=your_openai_api_key_here
# Optional: Use Groq instead of OpenAI
# GROQ_API_KEY=your_groq_api_key_here
```

Then, run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the application.

## Features

- **Real-time Research**: Watch as PraisonAI agents conduct research in real-time
- **Multi-agent Coordination**: See how different agents work together
- **Interactive UI**: Provide research topics and get detailed reports
- **CopilotKit Integration**: Seamless integration with the agent backend

## How it Works

1. **Frontend**: Built with Next.js, React, and Tailwind CSS
2. **Agent Integration**: Uses CopilotKit to connect with PraisonAI agents
3. **Real-time Updates**: See progress as agents work on your research
4. **Structured Output**: Results are formatted as clean, readable markdown

## Learn More

- [PraisonAI Agents Documentation](https://docs.praisonai.com)
- [CopilotKit Documentation](https://docs.copilotkit.ai)
- [Next.js Documentation](https://nextjs.org/docs) 
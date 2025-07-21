# Copilot Fully Custom

![leafy-green](https://github.com/user-attachments/assets/63f347ef-fefe-49c5-9162-6c88161fd9e0)


CopilotKit fully customized using components from MongoDB's Leafy Green Design System.

https://github.com/user-attachments/assets/92356944-090a-440c-bf8f-749bec5475e2



## Tech Stack

- [CopilotKit](https://copilotkit.ai)
- Next.js
- TypeScript
- [MongoDB Leafy Green Design System](https://www.mongodb.design/)
- TailwindCSS

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Setup your runtime:

CopilotKit requires `runtime`, a production-ready proxy for your LLM requests. You can either use Copilot Cloud or self-host it.

First, make a `.env` file in the root of the project.

```bash
touch .env
```

Now, you can either provide your [Copilot Cloud public API key](https://cloud.copilotkit.ai) or [OpenAI API key](https://platform.openai.com/api-keys).

> **Note:** Copilot Cloud will provide you some free OpenAI API credits to get you started!

```bash
OPENAI_API_KEY=sk... #if you want to use OpenAI
COPILOT_CLOUD_PUBLIC_API_KEY=ck... #if you want to use Copilot Cloud
```

2. Run the development server:

```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) to see the result.

## Customization

This project demonstrates how to fully customize CopilotKit using components from MongoDB's Leafy Green Design System.

To see this in action, take a look at the [components](./components) folder. In particular, the [Chat.tsx](./components/Chat.tsx) file demonstrates how to customize the chat interface using Leafy Green components.

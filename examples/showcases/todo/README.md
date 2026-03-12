This is a demo that showcases using CopilotKit to build a simple Todo app.

## Run the live demo

Want to see CopilotKit in action? Click the button below to try the live demo.

<a href="https://todo-demo-phi.vercel.app">
  <img src="./public/screenshot.png" alt="Todo Demo Screenshot" width="600px">
</a>

<a href="https://todo-demo-phi.vercel.app">
  <img src="./public/run-demo-cta.png" alt="Run the live demo" width="250px">
</a>

## Deploy with Vercel

To deploy with Vercel, click the button below:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FCopilotKit%2Fdemo-todo&env=NEXT_PUBLIC_COPILOT_CLOUD_API_KEY&project-name=copilotkit-demo-todo&repository-name=copilotkit-demo-todo)

## How to Build: a To-Do list app with an embedded AI copilot

Learn how to create a To-Do list app with an embedded AI copilot. This tutorial will guide you through the process step-by-step.

Tutorial: [How to Build: a To-Do list app with an embedded AI copilot](https://dev.to/copilotkit/how-to-build-an-ai-powered-to-do-list-nextjs-gpt4-copilotkit-20i4)

## Add your OpenAI API key

Add your environment variables to `.env.local` in the root of the project.

```
OPENAI_API_KEY=your-api-key
```

## Install dependencies

```bash
npm install
```

## Run the development server

```bash
npm run dev
```

## Open the demo

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## The Copilot-Specific parts of the code:

1. Notice `<CopilotKit />` and `<CopilotPopup />` in `page.tsx`

2. Notice `useCopilotReadable` in `page.tsx`

3. Notice the 2 `useCopilotAction` in `page.tsx`

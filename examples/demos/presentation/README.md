This is a demo that showcases using CopilotKit to build a PowerPoint like web app.

## Deploy with Vercel

To deploy with Vercel, click the button below:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FCopilotKit%2Fdemo-presentation&env=NEXT_PUBLIC_COPILOT_CLOUD_API_KEY,TAVILY_API_KEY,OPENAI_API_KEY&envDescription=By%20setting%20the%20TAVILY_API_KEY%2C%20you%20control%20whether%20the%20web%20search%20capabilities%20are%20enabled.%20Set%20it%20to%20NONE%20to%20disable%20this%20feature.%20To%20use%20TTS%2C%20set%20OPENAI_API%20key%2C%20otherwise%20set%20it%20to%20NONE.&project-name=copilotkit-demo-presentation&repository-name=copilotkit-demo-presentation)

## Getting Started`

### 1. install the needed package:

```bash
npm i
```

### 2. Set the required environment variables:

copy `.env.local.example` to `.env.local` and populate the required environment variables.

> ⚠️ **Important:** Not all users have access to the GPT-4 model yet. If you don't have access, you can use GPT-3 by setting `OPENAI_MODEL` to `gpt-3.5-turbo` in the `.env.local` file.

**If you want online research to work, you only need a tavily API key, which you can obtain here: https://tavily.com/**

### 3. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Zoom in on the CopilotKit code

1. Search for `useMakeCopilotReadable` to see where frontend application information is being made accessible to the Copilot engine

2. Search for `useAppendSlide` and `useUpdateSlide` to see where the frontend application action is made accessible to the Copilot engine.

3. In `route.ts`, see how the backend-running `researchAction` is defined against the `research.ts` agent, powered by LangChain's LangGraph and by Tavily research API.

```

## Learn More

To learn more about CopilotKit, take a look at the following resources:

- [CopilotKit Documentation](https://docs.copilotkit.ai/getting-started/quickstart-chatbot) - learn about CopilotKit features and API.
- [GitHub](https://github.com/CopilotKit/CopilotKit) - Check out the CopilotKit GitHub repository.
- [Discord](https://discord.gg/6dffbvGU3D) - Join the CopilotKit Discord community.
```

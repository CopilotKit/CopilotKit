## 🧮 CopilotKit Spreadsheet Demo
This is a demo that showcases using CopilotKit to build an Excel like web app.

## 🧑‍💻 Run the live demo

Want to see CopilotKit in action? Click the button below to try the live demo.

  <a href="https://x.com/copilotkit](https://spreadsheet-demo-tau.vercel.app/" target="_blank">
   Run Demo →
  </a> 
  <br></br>
  
![banner](https://github.com/user-attachments/assets/992b06ae-be6c-4bd2-ae57-20a793688e78)
  
## 🛠️ How to Build: A spreadsheet app with an AI-copilot

Learn how to create a powerful spreadsheet app using CopilotKit. This tutorial will guide you through the process step-by-step.

Tutorial: [How to Build: A spreadsheet app with an AI-copilot](https://dev.to/copilotkit/build-an-ai-powered-spreadsheet-app-nextjs-langchain-copilotkit-109d)

## 🚀 Getting Started

### 1. install the needed package:

```bash
npm i
```

### 2. Set the required environment variables:

copy `.env.local.example` to `.env.local` and populate the required environment variables.


### 3. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

### 4. Use the Copilot

Ask it to build a budget spreadsheet.

## 🔍 Zoom in on the CopilotKit code

1. Look for `/api/copilotkit/route.ts` and `/api/copilotkit/tavily.ts` - for the research agent integrated into the spreadsheet

2. Look for `useCopilotReadable` to see where frontend application context is being made accessible to the Copilot engine

3. Search for `updateSpreadsheet`, `appendToSpreadsheet`, and `createSpreadsheet` to see application interaction hooks made available to agents.

## 📚 Learn More

To learn more about CopilotKit, take a look at the following resources:

- [CopilotKit Documentation](https://docs.copilotkit.ai/getting-started/quickstart-chatbot) - learn about CopilotKit features and API.
- [GitHub](https://github.com/CopilotKit/CopilotKit) - Check out the CopilotKit GitHub repository.
- [Discord](https://discord.gg/6dffbvGU3D) - Join the CopilotKit Discord community.



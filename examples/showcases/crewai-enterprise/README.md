<div align="center">
  <a href="https://copilotkit.ai" target="_blank">
    <img src="./assets/banner.png" alt="CopilotKit Logo">
  </a>

  <br/>
</div>

### Build AI Agents with CopilotKit + CrewAI

_Prerequisites:_

#### 1. Get Your Accounts

- [CopilotKit Cloud Account](https://cloud.copilotkit.ai)
- [CrewAI Enterprise Account](https://www.crewai.com/enterprise)

#### 2. Setup CrewAI

- Get your CrewAI Enterprise URL and bearer token

#### 3. Configure CopilotKit

- Get your Crew's URL and bearer token from CrewAI Enterprise

  ![CrewAI Enterprise Setup](./assets/crew-ai-enterprise-setup.png)

- Go to [CopilotKit Cloud](https://cloud.copilotkit.ai/) and open your project setup, scroll down to Remote Endpoints Section

  ![Remote Endpoints Section](./assets/crew-remote-endpoint.png)

- Click "Add" to record your Crew API in Copilotkit

  ![Add CrewAI in CopilotKit Cloud](./assets/add-crew-in-copilot-cloud.png)

- Fill in your Crew's details and note the `Agent Name` - you'll need this exact name in your `<CopilotKit>` provider

  ![Fill in all the details](./assets/crew-remote-endpoint-registration.png)

#### 4. Configure OpenAI

Crew integration currently requires an OpenAI API Key for chat functionality. Configure this in your CopilotKit Cloud dashboard. We provide your first 50 requests free, and support for additional LLM providers is coming soon.

- In your `React` frontend app, add the `CopilotKit` provider to wrap your application:

```tsx
<CopilotKit
  agent="<your-agent-name-that-you-used-in-previous-step>"
  publicApiKey="<your-public-api-key-from-copilot-cloud>"
>
  {children}
</CopilotKit>
```

- Start with any of our prebuilt or headless UI components:

  - `<CopilotChat />` - Full-featured chat interface
  - `<CopilotTextarea />` - AI-powered text input
  - `<CopilotSidebarButton />` - Floating chat button
  - `useCopilotChat` - Headless chat hook

  See the [Components Documentation](https://docs.copilotkit.ai/reference/components) for more details.

## Getting Started

1. Clone this repository

```bash
git clone https://github.com/CopilotKit/CopilotKit.git
cd CopilotKit/examples/showcases/crewai-enterprise
```

2. Install dependencies

```bash
npm install
# or
yarn install
# or
pnpm install
```

3. Set up environment variables

Create a `.env.local` file in the root directory with the following variables:

```
NEXT_PUBLIC_AGENT_NAME=<YOUR_AGENT_NAME>
NEXT_PUBLIC_CPK_PUBLIC_API_KEY=<YOUR_CPK_KEY>
```

4. Start the development server

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

5. Open your browser

Navigate to [http://localhost:3000](http://localhost:3000) to see the application running.

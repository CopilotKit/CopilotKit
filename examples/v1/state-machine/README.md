# State Machine Copilot

Build a multi-step car sales flow with CopilotKit v2. This example uses agent context, stage-scoped frontend tools, and human-in-the-loop cards to keep each step explicit.

[Click here for a running example](https://copilotkit.ai/examples/state-machine-copilot)

<div align="center">
  <img src="./assets/preview.png" alt="State Machine Copilot for Car Sales"/>

  <a href="https://copilotkit.ai" target="_blank">
    <img src="https://img.shields.io/badge/Built%20with-CopilotKit-6963ff" alt="Built with CopilotKit"/>
  </a>
  <a href="https://nextjs.org" target="_blank">
    <img src="https://img.shields.io/badge/Built%20with-Next.js%2014-black" alt="Built with Next.js"/>
  </a>
  <a href="https://reactflow.dev/" target="_blank">
    <img src="https://img.shields.io/badge/Visualized%20with-React%20Flow-ff0072" alt="Visualized with React Flow"/>
  </a>
</div>

## 🚗 Overview

This application simulates a car dealership experience where an AI assistant guides users through a multi-stage process:

1. **Contact Information** - Collecting customer details
2. **Car Selection** - Helping users build their dream car
3. **Financing Options** - Offering payment alternatives
4. **Payment Processing** - Handling financing or direct payment
5. **Order Confirmation** - Finalizing the purchase

The example showcases how to implement complex conversational flows using a state machine pattern with CopilotKit.

## 🛠️ Getting Started

### Prerequisites

- Node.js 18+
- npm, yarn, or pnpm

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/CopilotKit/CopilotKit.git
   cd CopilotKit/examples/v1/state-machine
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

   <details>
     <summary><b>Using other package managers</b></summary>
     
     ```bash
     # Using yarn
     yarn install
     
     # Using npm
     npm install
     ```
   </details>

3. Create an `.env.local` file in the project root and add your OpenAI API key:

   ```
   OPENAI_API_KEY=your_api_key_here
   # Optional: defaults to openai/gpt-4o-mini
   COPILOTKIT_MODEL=openai/gpt-4o-mini
   ```

4. Start the development server:

   ```bash
   pnpm dev
   ```

   <details>
     <summary><b>Using other package managers</b></summary>
     
     ```bash
     # Using yarn
     yarn dev
     
     # Using npm
     npm run dev
     ```
   </details>

5. Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## 🧩 How It Works

This demo uses several key CopilotKit features to implement a state machine pattern:

### State Machine Architecture

The application is structured around 6 distinct stages, each with its own hook in the `stages` directory:

1. [getContactInfo](./src/lib/stages/use-stage-get-contact-info.tsx) - Collecting customer information
2. [buildCar](./src/lib/stages/use-stage-build-car.tsx) - Configuring car options
3. [sellFinancing](./src/lib/stages/use-stage-sell-financing.tsx) - Presenting financing options
4. [getFinancingInfo](./src/lib/stages/use-stage-get-financing-info.tsx) - Collecting financing details
5. [getPaymentInfo](./src/lib/stages/use-stage-get-payment-info.tsx) - Processing payment information
6. [confirmOrder](./src/lib/stages/use-stage-confirm-order.tsx) - Finalizing the order

Each stage hook owns its stage-scoped tools. The global provider sends the active instructions and current application data to the agent with `useAgentContext`.

### Global State Management

The [use-global-state.tsx](./src/lib/stages/use-global-state.tsx) hook manages the application's global state, while the [car-sales-chat.tsx](./src/components/car-sales-chat.tsx) component ties all stages together.

### State Visualization

A [React Flow](https://reactflow.dev/) powered visualizer ([state-visualizer.tsx](./src/components/state-visualizer.tsx)) displays the current state and possible transitions, updating in real-time as the conversation progresses.

### CopilotKit Integration

Each stage uses CopilotKit v2 hooks and Zod schemas:

```tsx
import {
  useAgentContext,
  useFrontendTool,
  useHumanInTheLoop,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

useAgentContext({
  description: "The current checkout step",
  value: { currentStage: stage, instructions: stageInstructions[stage] },
});

useFrontendTool({
  name: "selectFinancing",
  description: "Select the financing option",
  parameters: z.object({}),
  available: stage === "sellFinancing",
  handler: async () => {
    setStage("getFinancingInfo");
    return "Financing selected";
  },
});

useHumanInTheLoop({
  name: "getContactInformation",
  description: "Get the contact information of the user",
  parameters: z.object({}),
  available: stage === "getContactInfo",
  render: ({ status, respond }) => (
    <ContactInfo
      status={status}
      onSubmit={async (name, email, phone) => {
        if (!respond) return;
        setContactInfo({ name, email, phone });
        await respond("Contact information submitted");
      }}
    />
  ),
});
```

The Next.js catch-all route serves a v2 built-in agent:

```ts
import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({
      model: "openai/gpt-4o-mini",
      prompt: systemPrompt,
    }),
  },
  runner: new InMemoryAgentRunner(),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
```

## 📚 Learn More

Ready to build your own AI-powered state machine? Check out these resources:

- [CopilotKit Documentation](https://docs.copilotkit.ai) - Comprehensive guides and API references
- [CopilotKit v2 Migration Guide](https://docs.copilotkit.ai/migrate/v2) - Migrate v1 providers, hooks, tools, and runtime routes
- [CopilotKit Cloud](https://dashboard.operations.copilotkit.ai/) - Deploy your copilots with our managed cloud solution
- [React Flow Documentation](https://reactflow.dev/docs/introduction/) - Learn more about building interactive node-based UIs

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

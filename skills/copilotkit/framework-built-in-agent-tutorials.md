# Built In Agent — Tutorials

Tutorials guide for the Built In Agent integration.

> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.

## Guidance
### Next Steps
- Route: `/built-in-agent/tutorials/ai-powered-textarea/next-steps`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-powered-textarea/next-steps.mdx`

This is the end of the tutorial. You can now start building your own copilot-powered apps!

## Source code

You can find the source code and interactive sandboxes here:

- **Start app:** [GitHub](https://github.com/CopilotKit/example-textarea/tree/base-start-here) | [Stackblitz Sandbox](https://stackblitz.com/github/copilotkit/example-textarea/tree/base-start-here?file=lib%2Fhooks%2Fuse-tasks.tsx)
- **Final app:** [GitHub](https://github.com/CopilotKit/example-textarea/tree/final) | [Stackblitz Sandbox](https://stackblitz.com/github/copilotkit/example-textarea/tree/final?file=lib%2Fhooks%2Fuse-tasks.tsxd)

## What's next?

For next steps, here are some ideas:

- Add a chat element to your copilot using the [``](/reference/v1/components/chat/CopilotPopup) component.
- Add actions to your copilot using the [`useCopilotAction`](/reference/v1/hooks/useCopilotAction) hook.
- Follow the [Todos App Copilot tutorial](/built-in-agent/tutorials/ai-todo-app) to learn more about CopilotKit.

We have more tutorials coming soon.

## Need help?

If you have any questions, feel free to reach out to us on [Discord](https://discord.gg/6dffbvGU3D).

### Overview
- Route: `/built-in-agent/tutorials/ai-powered-textarea/overview`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-powered-textarea/overview.mdx`

## What you'll learn

In this tutorial, you will take a simple email application and add AI-powered autocompletion to it. The app is a simple email client, with a regular textarea used to compose an email. You're going to add CopilotKit to the app, so that the textarea provides relevant autocompletions as you type. The textarea will be aware of the full email history.

You will learn:

- 💡 How to use `useCopilotReadable` to allow your copilot to read the state of your app
- 💡 How to use the `` component to get instant context-aware autocompletions in your app
- 💡 How to use the Copilot Textarea Action Popup to generate text or adjust existing text in the textarea

## Try it out!

You can try out an interactive example of the end result below:

    >

In the next step, we'll start building our copilot.

### Step 1: Checkout the repo
- Route: `/built-in-agent/tutorials/ai-powered-textarea/step-1-checkout-repo`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-powered-textarea/step-1-checkout-repo.mdx`

### Checkout the repository
We'll begin by checking out the base code of the todo list app. We'll start from the `base-start-here` branch.

```shell
git clone -b base-start-here https://github.com/CopilotKit/example-textarea.git
cd example-textarea
```
### Install dependencies

To install the dependencies, run the following:

```shell
npm install
```
### Start the project

Now, you are ready to start the project by running:

```shell
npm run dev
```

You should be able to go to [http://localhost:3000](http://localhost:3000) and see the todo list app. Feel free to play around with the app to get a feel for it.

Next, let's start adding some AI copilot superpowers to this app.

### Step 2: Setup CopilotKit
- Route: `/built-in-agent/tutorials/ai-powered-textarea/step-2-setup-copilotkit`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-powered-textarea/step-2-setup-copilotkit.mdx`

Now that we have our todo list app running, we're ready to integrate CopilotKit. For this tutorial, we will install the following dependencies:

- `@copilotkit/react-core`: The core library for CopilotKit, which contains the CopilotKit provider and useful hooks.
- `@copilotkit/react-textarea`: The textarea component for CopilotKit, which enables you to get instant context-aware autocompletions in your app.

## Install Dependencies

To install the CopilotKit dependencies, run the following:

```npm
npm install @copilotkit/react-core @copilotkit/react-textarea
```

## Setup CopilotKit

In order to use CopilotKit, we'll need to configure the CopilotKit provider.

The [``](/reference/v1/components/CopilotKit) provider must wrap the Copilot-aware parts of your application.
For most use-cases, it's appropriate to wrap the `CopilotKit` provider around the entire app, e.g. in your `layout.tsx`

  Note that you can add the `` provider anywhere in your application. In fact, you can have multiple `` providers per app if you want independent copilots.

```tsx title="layout.tsx" showLineNumbers
import "./globals.css";

import { ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core"; // [!code highlight]

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
      <html lang="en">
        <body>
          {/* Use the public api key you got from Copilot Cloud  */}
          {/* [!code highlight:3] */}
          <CopilotKit publicApiKey="<your-copilot-cloud-public-api-key>">
            {children}
          </CopilotKit>
        </body>
      </html>
    );
}
```

### Set up Copilot Runtime Endpoint

  If you are planning to use a single LangGraph agent in agent-lock mode as your agentic backend, your LLM adapter will only be used for peripherals such as suggestions, etc.

If you are not sure yet, simply ignore this note.

            The LangChain adapter shown here is using OpenAI, but can be used with any LLM!

            Be aware that the empty adapter only works in combination with CoAgents in agent lock mode!

            In addition, bare in mind that `useCopilotChatSuggestions`, `CopilotTextarea` and `CopilotTask` will not work, as these require an LLM.

        ### Install provider package

```npm
        npm install {{packageName}}
```

        ### Add your API key

        Next, add your API key to your `.env` file in the root of your project (unless you prefer to provide it directly to the client):

```plaintext title=".env"
        {{envVarName}}=your_api_key_here
```

        ### Add your API key

        Next, add your API key to your `.env` file in the root of your project (unless you prefer to provide it directly to the client):

```plaintext title=".env"
        {{envVarSecret}}=your_secret_key_here
        {{envVarAccess}}=your_access_key_here
        {{envVarToken}}=your_session_token_here
```

            Please note that the code below uses GPT-4o, which requires a paid OpenAI API key. **If you are using a free OpenAI API key**, change the model to a different option such as `gpt-3.5-turbo`.

    ### Setup the Runtime Endpoint

        ### Serverless Function Timeouts

        When deploying to serverless platforms (Vercel, AWS Lambda, etc.), be aware that default function timeouts may be too short for CopilotKit's streaming responses:

        - Vercel defaults: 10s (Hobby), 15s (Pro)
        - AWS Lambda default: 3s

        **Solution options:**
        1. Increase function timeout:
```json
            // vercel.json
            {
              "functions": {
                "api/copilotkit/**/*": {
                  "maxDuration": 60
                }
              }
            }
```
        2. Use [Copilot Cloud](https://cloud.copilotkit.ai/) to avoid timeout issues entirely

        { value: 'Next.js App Router', icon:  },
        { value: 'Next.js Pages Router', icon:  },
        { value: 'Node.js Express', icon:  },
        { value: 'Node.js HTTP', icon:  },
        { value: 'NestJS', icon:  }
    ]}>

            Create a new route to handle the `/api/copilotkit` endpoint.

```ts title="app/api/copilotkit/route.ts"
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNextJSAppRouterEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}
            import { NextRequest } from 'next/server';

            {{clientSetup}}
            {{adapterSetup}}
            const runtime = new CopilotRuntime();

            export const POST = async (req: NextRequest) => {
              const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
                runtime,
                serviceAdapter,
                endpoint: '/api/copilotkit',
              });

              return handleRequest(req);
            };
```

            Your Copilot Runtime endpoint should be available at `http://localhost:3000/api/copilotkit`.

            Create a new route to handle the `/api/copilotkit` endpoint:

```ts title="pages/api/copilotkit.ts"
            import { NextApiRequest, NextApiResponse } from 'next';
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNextJSPagesRouterEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}

            {{clientSetup}}
            {{adapterSetup}}

            const handler = async (req: NextApiRequest, res: NextApiResponse) => {
              const runtime = new CopilotRuntime();

              const handleRequest = copilotRuntimeNextJSPagesRouterEndpoint({
                endpoint: '/api/copilotkit',
                runtime,
                serviceAdapter,
              });

              return await handleRequest(req, res);
            };

            export default handler;
```

            Your Copilot Runtime endpoint should be available at `http://localhost:3000/api/copilotkit`.

            Create a new Express.js app and set up the Copilot Runtime handler:

```ts title="server.ts"
            import express from 'express';
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNodeHttpEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}

            const app = express();
            {{clientSetup}}
            {{adapterSetup}}

            app.use('/copilotkit', (req, res, next) => {
              (async () => {
                const runtime = new CopilotRuntime();
                const handler = copilotRuntimeNodeHttpEndpoint({
                  endpoint: '/copilotkit',
                  runtime,
                  serviceAdapter,
                });

                return handler(req, res);
              })().catch(next);
            });

            app.listen(4000, () => {
              console.log('Listening at http://localhost:4000/copilotkit');
            });
```

            Your Copilot Runtime endpoint should be available at `http://localhost:4000/copilotkit`.

                Remember to point your `runtimeUrl` to the correct endpoint in your client-side code, e.g. `http://localhost:PORT/copilotkit`.

            Set up a simple Node.js HTTP server and use the Copilot Runtime to handle requests:

```ts title="server.ts"
            import { createServer } from 'node:http';
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNodeHttpEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}

            {{clientSetup}}
            {{adapterSetup}}

            const server = createServer((req, res) => {
              const runtime = new CopilotRuntime();
              const handler = copilotRuntimeNodeHttpEndpoint({
                endpoint: '/copilotkit',
                runtime,
                serviceAdapter,
              });

              return handler(req, res);
            });

            server.listen(4000, () => {
              console.log('Listening at http://localhost:4000/copilotkit');
            });
```

            Your Copilot Runtime endpoint should be available at `http://localhost:4000/copilotkit`.

                Remember to point your `runtimeUrl` to the correct endpoint in your client-side code, e.g. `http://localhost:PORT/copilotkit`.

            Set up a controller in NestJS to handle the Copilot Runtime endpoint:

```ts title="copilotkit.controller.ts"
            import { All, Controller, Req, Res } from '@nestjs/common';
            import { CopilotRuntime, copilotRuntimeNestEndpoint, {{adapterImport}} } from '@copilotkit/runtime';
            import { Request, Response } from 'express';

            @Controller()
            export class CopilotKitController {
              @All('/copilotkit')
              copilotkit(@Req() req: Request, @Res() res: Response) {
                {{adapterSetup}}
                const runtime = new CopilotRuntime();

                const handler = copilotRuntimeNestEndpoint({
                  runtime,
                  serviceAdapter,
                  endpoint: '/copilotkit',
                });
                return handler(req, res);
              }
            }
```

            Your Copilot Runtime endpoint should be available at `http://localhost:3000/copilotkit`.

                Remember to point your `runtimeUrl` to the correct endpoint in your client-side code, e.g. `http://localhost:PORT/copilotkit`.

### Configure the CopilotKit Provider

```tsx title="app/page.tsx" showLineNumbers {5,10,14}
"use client";

import { EmailThread } from "@/components/EmailThread";
import { EmailsProvider } from "@/lib/hooks/use-emails";
import { CopilotKit } from "@copilotkit/react-core/v2"; // [!code highlight]
import "@copilotkit/react-textarea/styles.css"; // [!code highlight]

export default function Home() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      {" "}
      // [!code highlight]
      <EmailsProvider>
        <EmailThread />
      </EmailsProvider>
    {/* [!code highlight:1] */}
    </CopilotKit>
  );
}
```

Let's break this down:

- First, we imported the `CopilotKit` provider from `@copilotkit/react-core`.
- Then, we wrapped the page with the `` provider.
- We imported the built-in styles from `@copilotkit/react-textarea`.

In the next step, we'll implement the AI-powered textarea as a replacement for our existing input component.

### Step 4: Copilot Textarea
- Route: `/built-in-agent/tutorials/ai-powered-textarea/step-3-copilot-textarea`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-powered-textarea/step-3-copilot-textarea.mdx`

Currently, our app has a simple textarea for replying to emails. Let's replace this with an AI-powered textarea so that we can benefit from our helpful AI assistant.

## The `` Component

Head over to the [`/components/Reply.tsx`](https://github.com/CopilotKit/example-textarea/blob/base-start-here/components/Reply.tsx) file.

At a glance, you can see that this component uses `useState` to hold the current input value and provide it to the textarea. We also use the `onChange` prop of the textarea to update the state.

## Implementing ``

The `` component was designed to be a drop-in replacement for the `` component. Let's implement it!

```tsx title="components/Reply.tsx"
// ... the rest of the file

import { CopilotTextarea } from "@copilotkit/react-textarea"; // [!code highlight]

export function Reply() {
  // ...
  return (
    <div className="mt-4 pt-4 space-y-2 bg-background p-4 rounded-md border">
      <CopilotTextarea // [!code highlight]
        className="min-h-40 border h-40 p-2 overflow-hidden"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Write your reply..."
        // [!code highlight:4]
        autosuggestionsConfig={{
          textareaPurpose: `Assist me in replying to this email thread. Remember all important details.`,
          chatApiConfigs: {}
        }}
      />
      <Button disabled={!input} onClick={handleReply}>
        Reply
      </Button>
    </div>
  );
}
```

We import the `` component and use it in place of the `` component. There are also some optional style changes made here.

We can provide more specific instructions for this particular textarea via the `autoSuggestionsConfig.textareaPurpose` property.

## Try it out!

Now, go back to the app and type anything in the textarea. You will see that the AI assistant provides suggestions as you type. How cool is that?

## The `CMD + K`/`CTRL + K` Shortcut

While focused on the textarea, you can use the `CMD + K` (macOS) or `CTRL + K` (Windows) shortcut to open the action popup. Here, you can give the copilot specific instructions, such as:

- `Rephrase the text to be more formal`
- `Make the reply shorter`
- `Tell John that I'm happy to help`

We have implemented the `` component, but there is an issue - the copilot assistant is not aware of the email thread. In the next step, we'll make CopilotKit aware of our email history.

### Step 3: Copilot Readable State
- Route: `/built-in-agent/tutorials/ai-powered-textarea/step-4-copilot-readable-state`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-powered-textarea/step-4-copilot-readable-state.mdx`

At this point, we have set up our CopilotKit provider and ``, and we already benefit from a great AI assistant. However, there is one last problem - the copilot assistant is not aware of the email thread. Let's fix that.

## Our App's State

Let's quickly review how our app's state works. Open up the [`lib/hooks/use-emails.tsx`](https://github.com/CopilotKit/example-textarea/blob/base-start-here/lib/hooks/use-emails.tsx) file.

At a glance, we can see that the file exposes a provider (`EmailsProvider`) which holds our `emails`. This is the context we need to provide to our copilot to get AI autocompletions.

## The `useCopilotReadable` hook

Our goal is to make our copilot aware of this state, so that it can provide more accurate and helpful responses. We can easily achieve this by using the [`useCopilotReadable`](/reference/v1/hooks/useCopilotReadable) hook.

```tsx title="libs/hooks/use-emails.tsx"
// ... the rest of the file

import { useCopilotReadable } from "@copilotkit/react-core/v2"; // [!code highlight]

export const EmailsProvider = ({ children }: { children: ReactNode }) => {
  const [emails, setEmails] = useState<Email[]>(emailHistory);

  // [!code highlight:4]
  useCopilotReadable({
    description: "The history of this email thread",
    value: emails
  });

  // ... the rest of the file
}
```

In this example, we use the `useCopilotReadable` hook to provide the copilot with the state of our email thread.

- For the `description` property, we provide a concise description that tells the copilot what this piece of readable data means.
- For the `value` property, we pass the entire state as a JSON string.

In the next step, we'll set up our AI-powered textarea, which will use this readable state to provide accurate and helpful responses.

## Try it out!

Now, go back to the app and start typing things related to the email thread. Some ideas:

- `"Thanks Jo..."` (the assistant will complete John's name)
- `"I'm glad Spac..."` (the assistant will complete the company's name to SpaceY)
- `"I'm glad they liked my..."` (the assistant will add context)

Your textarea is now fully aware of the email thread, and therefore it provides helpful, relevant autocompletions. 🚀

### Next Steps
- Route: `/built-in-agent/tutorials/ai-todo-app/next-steps`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-todo-app/next-steps.mdx`

This is the end of the tutorial. You can now start building your own copilot-powered apps!

## Source code

You can find the source code and interactive sandboxes here:

- **Start app:** [GitHub](https://github.com/CopilotKit/example-todos-app/tree/base-start-here) | [Stackblitz Sandbox](https://stackblitz.com/github/copilotkit/example-todos-app/tree/base-start-here?file=lib%2Fhooks%2Fuse-tasks.tsx)
- **Final app:** [GitHub](https://github.com/CopilotKit/example-todos-app/tree/final) | [Stackblitz Sandbox](https://stackblitz.com/github/copilotkit/example-todos-app/tree/final?file=lib%2Fhooks%2Fuse-tasks.tsxd)

## What's next?

For next steps, here are some ideas:

- Add suggestions to your copilot, using the [`useCopilotChatSuggestions`](/reference/v1/hooks/useCopilotChatSuggestions) hook.
- Add an initial assistant message to your chat window (for more info, check the documentation for [``](/reference/v1/components/chat/CopilotPopup)).
- Dive deeper into the useful [`useCopilotChat`](/reference/v1/hooks/useCopilotChat) hook, which enables you to set the system message, append messages, and more.
- Implement autocompletion using the [``](/reference/v1/components/CopilotTextarea) component.
- Follow the [Textarea Autocomplete tutorial](/built-in-agent/tutorials/ai-powered-textarea) to learn more about CopilotKit.

We have more tutorials coming soon.

## Need help?

If you have any questions, feel free to reach out to us on [Discord](https://discord.gg/6dffbvGU3D).

### Overview
- Route: `/built-in-agent/tutorials/ai-todo-app/overview`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-todo-app/overview.mdx`

# AI Todo List Copilot Tutorial

## What you'll learn

In this tutorial, you will take a simple todo list app and supercharge it with a copilot. You will learn:

- 💡 How to embed an in-app copilot with a chat UI
- 💡 How to use `useCopilotReadable` to allow your copilot to read the state of your app
- 💡 How to use `useFrontendTool` to allow your copilot to execute tools

## Try it out!

You can try out an interactive example of the end result below:

    >

In the next step, we'll start building our copilot.

### Step 1: Checkout the repo
- Route: `/built-in-agent/tutorials/ai-todo-app/step-1-checkout-repo`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-todo-app/step-1-checkout-repo.mdx`

### Checkout the repository
We'll begin by checking out the base code of the todo list app. We'll start from the `base-start-here` branch.

```shell
git clone -b base-start-here https://github.com/CopilotKit/example-todos-app.git
cd example-todos-app
```
### Install dependencies

To install the dependencies, run the following:

```shell
npm install
```
### Start the project

Now, you are ready to start the project by running:

```shell
npm run dev
```

You should be able to go to [http://localhost:3000](http://localhost:3000) and see the todo list app. Feel free to play around with the app to get a feel for it.

Next, let's start adding some AI copilot superpowers to this app.

### Step 2: Setup CopilotKit
- Route: `/built-in-agent/tutorials/ai-todo-app/step-2-setup-copilotkit`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-todo-app/step-2-setup-copilotkit.mdx`

Now that we have our todo list app running, we're ready to integrate CopilotKit. For this tutorial, we will install the following dependencies:

- `@copilotkit/react-core`: The core library for CopilotKit, which contains the CopilotKit provider and useful hooks.
- `@copilotkit/react-ui`: The UI library for CopilotKit, which contains the CopilotKit UI components such as the sidebar, chat popup, textarea and more.

## Install Dependencies

To install the CopilotKit dependencies, run the following:

```npm
npm install @copilotkit/react-core @copilotkit/react-ui
```

## Setup CopilotKit

In order to use CopilotKit, we'll need to configure the `CopilotKit` provider.

The [``](/reference/v1/components/CopilotKit) provider must wrap the Copilot-aware parts of your application.
For most use-cases, it's appropriate to wrap the `CopilotKit` provider around the entire app, e.g. in your `layout.tsx`

  Note that you can add the `` provider anywhere in your application. In fact, you can have multiple `` providers per app if you want independent copilots.

```tsx title="layout.tsx" showLineNumbers
import "./globals.css";

import { ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core"; // [!code highlight]

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
      <html lang="en">
        <body>
          {/* Use the public api key you got from Copilot Cloud  */}
          {/* [!code highlight:3] */}
          <CopilotKit publicApiKey="<your-copilot-cloud-public-api-key>">
            {children}
          </CopilotKit>
        </body>
      </html>
    );
}
```

### Set up Copilot Runtime Endpoint

  If you are planning to use a single LangGraph agent in agent-lock mode as your agentic backend, your LLM adapter will only be used for peripherals such as suggestions, etc.

If you are not sure yet, simply ignore this note.

            The LangChain adapter shown here is using OpenAI, but can be used with any LLM!

            Be aware that the empty adapter only works in combination with CoAgents in agent lock mode!

            In addition, bare in mind that `useCopilotChatSuggestions`, `CopilotTextarea` and `CopilotTask` will not work, as these require an LLM.

        ### Install provider package

```npm
        npm install {{packageName}}
```

        ### Add your API key

        Next, add your API key to your `.env` file in the root of your project (unless you prefer to provide it directly to the client):

```plaintext title=".env"
        {{envVarName}}=your_api_key_here
```

        ### Add your API key

        Next, add your API key to your `.env` file in the root of your project (unless you prefer to provide it directly to the client):

```plaintext title=".env"
        {{envVarSecret}}=your_secret_key_here
        {{envVarAccess}}=your_access_key_here
        {{envVarToken}}=your_session_token_here
```

            Please note that the code below uses GPT-4o, which requires a paid OpenAI API key. **If you are using a free OpenAI API key**, change the model to a different option such as `gpt-3.5-turbo`.

    ### Setup the Runtime Endpoint

        ### Serverless Function Timeouts

        When deploying to serverless platforms (Vercel, AWS Lambda, etc.), be aware that default function timeouts may be too short for CopilotKit's streaming responses:

        - Vercel defaults: 10s (Hobby), 15s (Pro)
        - AWS Lambda default: 3s

        **Solution options:**
        1. Increase function timeout:
```json
            // vercel.json
            {
              "functions": {
                "api/copilotkit/**/*": {
                  "maxDuration": 60
                }
              }
            }
```
        2. Use [Copilot Cloud](https://cloud.copilotkit.ai/) to avoid timeout issues entirely

        { value: 'Next.js App Router', icon:  },
        { value: 'Next.js Pages Router', icon:  },
        { value: 'Node.js Express', icon:  },
        { value: 'Node.js HTTP', icon:  },
        { value: 'NestJS', icon:  }
    ]}>

            Create a new route to handle the `/api/copilotkit` endpoint.

```ts title="app/api/copilotkit/route.ts"
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNextJSAppRouterEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}
            import { NextRequest } from 'next/server';

            {{clientSetup}}
            {{adapterSetup}}
            const runtime = new CopilotRuntime();

            export const POST = async (req: NextRequest) => {
              const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
                runtime,
                serviceAdapter,
                endpoint: '/api/copilotkit',
              });

              return handleRequest(req);
            };
```

            Your Copilot Runtime endpoint should be available at `http://localhost:3000/api/copilotkit`.

            Create a new route to handle the `/api/copilotkit` endpoint:

```ts title="pages/api/copilotkit.ts"
            import { NextApiRequest, NextApiResponse } from 'next';
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNextJSPagesRouterEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}

            {{clientSetup}}
            {{adapterSetup}}

            const handler = async (req: NextApiRequest, res: NextApiResponse) => {
              const runtime = new CopilotRuntime();

              const handleRequest = copilotRuntimeNextJSPagesRouterEndpoint({
                endpoint: '/api/copilotkit',
                runtime,
                serviceAdapter,
              });

              return await handleRequest(req, res);
            };

            export default handler;
```

            Your Copilot Runtime endpoint should be available at `http://localhost:3000/api/copilotkit`.

            Create a new Express.js app and set up the Copilot Runtime handler:

```ts title="server.ts"
            import express from 'express';
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNodeHttpEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}

            const app = express();
            {{clientSetup}}
            {{adapterSetup}}

            app.use('/copilotkit', (req, res, next) => {
              (async () => {
                const runtime = new CopilotRuntime();
                const handler = copilotRuntimeNodeHttpEndpoint({
                  endpoint: '/copilotkit',
                  runtime,
                  serviceAdapter,
                });

                return handler(req, res);
              })().catch(next);
            });

            app.listen(4000, () => {
              console.log('Listening at http://localhost:4000/copilotkit');
            });
```

            Your Copilot Runtime endpoint should be available at `http://localhost:4000/copilotkit`.

                Remember to point your `runtimeUrl` to the correct endpoint in your client-side code, e.g. `http://localhost:PORT/copilotkit`.

            Set up a simple Node.js HTTP server and use the Copilot Runtime to handle requests:

```ts title="server.ts"
            import { createServer } from 'node:http';
            import {
              CopilotRuntime,
              {{adapterImport}},
              copilotRuntimeNodeHttpEndpoint,
            } from '@copilotkit/runtime';
            {{extraImports}}

            {{clientSetup}}
            {{adapterSetup}}

            const server = createServer((req, res) => {
              const runtime = new CopilotRuntime();
              const handler = copilotRuntimeNodeHttpEndpoint({
                endpoint: '/copilotkit',
                runtime,
                serviceAdapter,
              });

              return handler(req, res);
            });

            server.listen(4000, () => {
              console.log('Listening at http://localhost:4000/copilotkit');
            });
```

            Your Copilot Runtime endpoint should be available at `http://localhost:4000/copilotkit`.

                Remember to point your `runtimeUrl` to the correct endpoint in your client-side code, e.g. `http://localhost:PORT/copilotkit`.

            Set up a controller in NestJS to handle the Copilot Runtime endpoint:

```ts title="copilotkit.controller.ts"
            import { All, Controller, Req, Res } from '@nestjs/common';
            import { CopilotRuntime, copilotRuntimeNestEndpoint, {{adapterImport}} } from '@copilotkit/runtime';
            import { Request, Response } from 'express';

            @Controller()
            export class CopilotKitController {
              @All('/copilotkit')
              copilotkit(@Req() req: Request, @Res() res: Response) {
                {{adapterSetup}}
                const runtime = new CopilotRuntime();

                const handler = copilotRuntimeNestEndpoint({
                  runtime,
                  serviceAdapter,
                  endpoint: '/copilotkit',
                });
                return handler(req, res);
              }
            }
```

            Your Copilot Runtime endpoint should be available at `http://localhost:3000/copilotkit`.

                Remember to point your `runtimeUrl` to the correct endpoint in your client-side code, e.g. `http://localhost:PORT/copilotkit`.

### Configure the CopilotKit Provider

```tsx title="layout.tsx"
import "./globals.css";
import { ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core"; // [!code highlight]

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body> 
        {/* Make sure to use the URL you configured in the previous step  */}
        {/* [!code highlight:3] */}
        <CopilotKit runtimeUrl="/api/copilotkit"> 
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}

</Step>
</Steps>
</TailoredContentOption>
</TailoredContent>

### CopilotKit Chat Popup

We provide several plug-and-play components for you to interact with your copilot. Some of these are `<CopilotPopup/>`, `<CopilotSidebar/>`, and `<CopilotChat/>`. You can of course use CopilotKit in headless mode and provide your own fully custom UI via [`useCopilotChat`](/reference/v1/hooks/useCopilotChat).

In this tutorial, we'll use the `<CopilotPopup/>` component to display the chat popup.

```tsx title="app/page.tsx" showLineNumbers {6-7,15}
"use client";

```

Here's what we did:

- We imported the `<CopilotPopup />` component from `@copilotkit/react-ui`.
- We wrapped the page with the `<CopilotKit>` provider.
- We imported the built-in styles from `@copilotkit/react-ui`.

Now, head back to your app and you'll find a chat popup in the bottom right corner of the page. At this point, you can start interacting with your copilot! 🎉

In the next step, we'll make our assistant smarter by providing it with readable state about our todo list.

### Step 3: Copilot Readable State
- Route: `/built-in-agent/tutorials/ai-todo-app/step-3-copilot-readable-state`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-todo-app/step-3-copilot-readable-state.mdx`

At this point, we have a chat popup in our app and we're able to chat directly with our copilot. This is great, but our copilot doesn't know anything about our app. In this step, we'll provide our copilot with the state of our todos.

In this step, you'll learn how to provide knowledge to the copilot. In our case, we want the copilot to know about the tasks in our app.

## Our App's State

Let's quickly review how our app's state works. Open up the [`lib/hooks/use-tasks.tsx`](https://github.com/CopilotKit/example-todos-app/blob/base-start-here/lib/hooks/use-tasks.tsx) file.

At a glance, we can see that the file exposes a provider (`TasksProvider`), which defines a useful things:

- The state of our tasks (`tasks`)
- A function to add a task (`addTask`)
- A function to update a task (`updateTask`)
- A function to delete a task (`deleteTask`)

All of this is consumable by a `useTasks` hook, which we use in the rest of our application (feel free to check out the `TasksList`, `AddTask` and `Task` components).

This resembles the majority of React apps, where frontend state, either for a feature or the entire app, is managed by a context or state management library.

## The `useCopilotReadable` hook

Our goal is to make our copilot aware of this state, so that it can provide more accurate and helpful responses. We can easily achieve this by using the [`useCopilotReadable`](/reference/v1/hooks/useCopilotReadable) hook.

```tsx title="lib/hooks/use-tasks.tsx" {3,8-11}
// ... the rest of the file

import { useCopilotReadable } from "@copilotkit/react-core/v2"; // [!code highlight]

export const TasksProvider = ({ children }: { children: ReactNode }) => {
  const [tasks, setTasks] = useState<Task[]>(defaultTasks);

  // [!code highlight:4]
  useCopilotReadable({
    description: "The state of the todo list",
    value: JSON.stringify(tasks)
  });

  // ... the rest of the file
}
```

In this example, we use the `useCopilotReadable` hook to provide the copilot with the state of our tasks.

- For the `description` property, we provide a concise description that tells the copilot what this piece of readable data means.
- For the `value` property, we pass the entire state as a JSON string.

## Try it out!

Now, try it out! Ask your Copilot a question about the state of the todo list. For example:

> How many tasks do I still need to get done?

Magical, isn't it? ✨ In the next step, you'll learn how to make the copilot take actions based on the state of your app.

### Step 4: Frontend Tools
- Route: `/built-in-agent/tutorials/ai-todo-app/step-4-frontend-tools`
- Source: `docs/content/docs/integrations/built-in-agent/tutorials/ai-todo-app/step-4-frontend-tools.mdx`

Now it's time to make our copilot even more useful by enabling it to execute tools.

## Available Tools

Once again, let's take a look at our app's state in the [`lib/hooks/use-tasks.tsx`](https://github.com/CopilotKit/example-todos-app/blob/base-start-here/lib/hooks/use-tasks.tsx#L19-L33) file.

Essentially, we want our copilot to be able to call the `addTask`, `setTaskStatus` and `deleteTask` functions.

## The `useFrontendTool` hook

The [`useFrontendTool`](/reference/v1/hooks/useFrontendTool) hook makes tools available to our copilot. Let's implement it in the [`lib/hooks/use-tasks.tsx`](https://github.com/CopilotKit/example-todos-app/blob/base-start-here/lib/hooks/use-tasks.tsx) file.

```tsx filename="lib/hooks/use-tasks.tsx" showLineNumbers {3-3,8-22,24-38,40-61}
// ... the rest of the file

import { useCopilotReadable, useFrontendTool } from "@copilotkit/react-core/v2"; // [!code highlight]
import { z } from "zod"; // [!code highlight]

export const TasksProvider = ({ children }: { children: ReactNode }) => {
  const [tasks, setTasks] = useState<Task[]>(defaultTasks);

  // [!code highlight:10]
  useFrontendTool({
    name: "addTask",
    description: "Adds a task to the todo list",
    parameters: z.object({
      title: z.string().describe("The title of the task"),
    }),
    handler: ({ title }) => {
      addTask(title);
      return `Added task: ${title}`;
    },
  });

  // [!code highlight:10]
  useFrontendTool({
    name: "deleteTask",
    description: "Deletes a task from the todo list",
    parameters: z.object({
      id: z.number().describe("The id of the task"),
    }),
    handler: ({ id }) => {
      deleteTask(id);
      return `Deleted task ${id}`;
    },
  });

  // [!code highlight:11]
  useFrontendTool({
    name: "setTaskStatus",
    description: "Sets the status of a task",
    parameters: z.object({
      id: z.number().describe("The id of the task"),
      status: z.enum(Object.values(TaskStatus) as [string, ...string[]]).describe("The status of the task"),
    }),
    handler: ({ id, status }) => {
      setTaskStatus(id, status);
      return `Set task ${id} status to ${status}`;
    },
  });

  // ... the rest of the file
};
```

The `useFrontendTool` hook is a powerful hook that allows us to register tools with our copilot. It takes an object with the following properties:

- `name` is the name of the tool.
- `description` is a description of the tool. It's important to choose a good description so that our copilot can choose the right tool.
- `parameters` is a Zod schema that defines the parameters the tool accepts. This provides runtime validation and TypeScript type inference.
- `handler` is a function that will be called when the tool is triggered. It's type safe thanks to Zod!

You can check out the full reference for the `useFrontendTool` hook [here](https://docs.copilotkit.ai/reference/v1/hooks/useFrontendTool).

## Try it out!

Now, head back to the app and ask your pilot to do any of the following:

- "Create a task about inviting Daniel to my birthday"
- "Delete all outstanding tasks"
- "Mark task with ID 2 as done"
- etc.

Your copilot is now more helpful than ever 💪

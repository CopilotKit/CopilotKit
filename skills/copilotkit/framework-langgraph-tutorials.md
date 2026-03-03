# LangGraph — Tutorials

Tutorials guide for the LangGraph integration.

> For shared CopilotKit concepts (runtime setup, prebuilt components, troubleshooting, etc.), see the topic guides. This file focuses on framework-specific implementation details.

## Guidance
### Overview
- Route: `/langgraph/tutorials/agent-native-app`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/index.mdx`

# Research Agent Native Application (ANA)

## What you'll learn

In this tutorial, we'll build a Research Agent Native Application (ANA) using CopilotKit. Starting with a basic application, we'll add agent capabilities step by step.

You'll learn:
- 🎯 Core principles of agent native applications
- 🔄 How LangGraph helps structure LLM behavior
- 🧱 Building blocks of a Copilot Agent (CoAgent)
- 🛠️ Creating interactive agent experiences with CopilotKit

## Let's get started!
Next, we'll set up the project and install dependencies.

### Next Steps
- Route: `/langgraph/tutorials/agent-native-app/next-steps`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/next-steps.mdx`

This is the end of the tutorial. You now know the basics of how to build complex agentic experiences into your own applications.

## Source code

You can find the source code and interactive sandboxes here:
- [Start app](https://github.com/CopilotKit/open-research-ANA/tree/tutorial-start)
- [Final app](https://github.com/CopilotKit/open-research-ANA/tree/main)

## What's next?

For next steps, here are some ideas:

- Add persistence for [messages](/langgraph/advanced/persistence/loading-message-history) and [agent state](/langgraph/advanced/persistence/loading-agent-state).
- Enhance the back-and-fourth with the agent by adding more tools that can update the agent's state.
- Allow the human to ask for inline editing of the research report.

We have more tutorials coming soon, please let us know if you have any ideas for what you'd like to see next!

## Need help?

If you have any questions, feel free to reach out to us on [Discord](https://discord.gg/6dffbvGU3D).

### Step 1: Checkout the repo
- Route: `/langgraph/tutorials/agent-native-app/step-1-checkout-repo`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/step-1-checkout-repo.mdx`

## Get the starting code
We'll use the [open-research-ana repository](https://github.com/CopilotKit/open-research-ana) as our starting point. Clone the `tutorial-start` branch:

```shell
git clone -b tutorial-start https://github.com/CopilotKit/open-research-ana.git
cd open-research-ana
```

The repository contains:
- `frontend/`: A NextJS application where we'll integrate our agent
- `agent/`: A Python-based LangGraph agent we'll enhance with CopilotKit

## Install frontend dependencies
Navigate to the frontend directory and install dependencies:

```shell
cd frontend
pnpm install
```
## Start the application
Launch the development server:

```shell
pnpm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to see the initial application. You'll see an empty chat interface and document - this is our starting point.

Next, we'll explore how our LangGraph agent works.

### Step 2: Start the Agent
- Route: `/langgraph/tutorials/agent-native-app/step-2-start-the-agent`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/step-2-start-the-agent.mdx`

```shell
cd agent
touch .env
```
```txt title=".env"
OPENAI_API_KEY=<your-openai-api-key>
TAVILY_API_KEY=<your-tavily-api-key>
```
```shell
pip install -r requirements.txt # Install dependencies
brew install langgraph-cli # Install LangGraph CLI
langgraph dev --host localhost --port 8000 # Start the agent
```

### Step 3: Setup CopilotKit
- Route: `/langgraph/tutorials/agent-native-app/step-3-setup-copilotkit`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/step-3-setup-copilotkit.mdx`

Now that we have both our application and agent running, let's connect them using CopilotKit. The necessary dependencies are already installed in the `frontend` directory:

- `@copilotkit/react-core`: Core CopilotKit functionality and hooks
- `@copilotkit/react-ui`: Pre-built UI components for chat interfaces

  **The package versions in this tutorial are pinned, so updating the dependencies could break the tutorial.**

```npm
  npm install @copilotkit/react-core @copilotkit/react-ui
```

### Set up Copilot Cloud
Create a [Copilot Cloud account](https://cloud.copilotkit.ai/sign-in) to get started. This provides a production-ready proxy to your LLMs.

Copilot Cloud includes free LLM credits for development.

### Get a Copilot Cloud API Key

Once logged in, you'll see some on boarding steps. The main thing we'll need is a public API key. To do this,
you'll need to create an OpenAI API key and provide it to Copilot Cloud.

### Configure environment variables
Create and populate the frontend environment file:

```shell
touch frontend/.env
```

Then, add your Copilot Cloud API key to the file like so:

```txt title="frontend/.env"
NEXT_PUBLIC_CPK_PUBLIC_API_KEY=...
```

### Add the CopilotKit provider
Wrap your application with the CopilotKit provider:

```tsx title="frontend/src/app/layout.tsx"
"use client";

// ...
import { CopilotKit } from "@copilotkit/react-core/v2"; // [!code ++]
import "@copilotkit/react-ui/v2/styles.css"; // [!code ++]
// ...

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
      <html lang="en" className="h-full">
        <body className={`${lato.variable} ${noto.className} antialiased h-full`}>
          // [!code ++:4]
          <CopilotKit
            publicApiKey={process.env.NEXT_PUBLIC_CPK_PUBLIC_API_KEY}
          >
            <TooltipProvider>
              <ResearchProvider>
                {children}
              </ResearchProvider>
            </TooltipProvider>
          </CopilotKit> // [!code ++]
        </body>
      </html>
    );
}
```

### Adding a chat interface

We provide several customizeable components for you to interact with your copilot. Some of these are [``](/reference/v1/components/chat/CopilotPopup), [``](/reference/v1/components/chat/CopilotSidebar), and [``](/reference/v1/components/chat/CopilotChat), and your own fully custom UI via [`useCopilotChat`](/reference/v1/hooks/useCopilotChat).

In this tutorial, we'll use the `` component as we want to aim for a non-modal chat interface.

  The `Chat` component will serve as a wrapper around the CopilotKit `CopilotChat` component. This is to help simplify
  what you'll need to write along the way.

```tsx title="frontend/src/components/Chat.tsx"
"use client"

import { CopilotChat } from "@copilotkit/react-core/v2";
import { INITIAL_MESSAGE, MAIN_CHAT_INSTRUCTIONS, MAIN_CHAT_TITLE } from "@/lib/consts";

export default function Chat({ onSubmitMessage }: { onSubmitMessage: () => void }) {
  return (
      // [!code ++:10]
      <CopilotChat
          labels={{
              modalHeaderTitle: MAIN_CHAT_TITLE,
              welcomeMessageText: INITIAL_MESSAGE,
          }}
          className="h-full w-full font-noto"
          onSubmitMessage={onSubmitMessage}
      />
      // [!code --:4]
      <h1 className="text-2xl font-bold flex items-center justify-center h-full mx-auto mr-20">
        It'd be really cool if we had chat here!
      </h1>
  )
}
```

## Recap

And we're done! Here's what we did:

- We setup our Copilot cloud account and got an API key.
- We configured the CopilotKit provider in our application to use our API key.
- We added the CopilotSidebar to our application.

Now, head back to the app and you'll find a chat interface on the left side of the page. At this point, you can start interacting with your copilot! 🎉

This is a very simple copilot that isn't talking to our LangGraph yet. In the next step, we'll be adding the LangGraph agent to the mix.

### Step 4: Agentic Chat UI
- Route: `/langgraph/tutorials/agent-native-app/step-4-agentic-chat-ui`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/step-4-agentic-chat-ui.mdx`

At this point, we have a LangGraph agent running in LangGraph Studio and have a simple copilot. Now, let's
combine the two together to make an copilot agent (CoAgent)!

## Connect the agent to CopilotKit
We need to make CopilotKit aware of our running LangGraph agent. To do this, we will setup a remote
endpoint to connect to our locally running agent.

Since we're using Copilot Cloud, this is as simple as running the following command for local development.

```bash
npx copilotkit@latest dev --port 8000
```
```sh
✔ Select a project Local (ID: <project_id>)
✅ LangGraph Platform endpoint detected
⠹ Creating tunnel...

Tunnel Information:

• Tunnel URL:            https://<tunnel_id>.tunnels.devcopilotkit.com
• Endpoint Type:         LangGraph Platform
• Project:               projects/<project_id>

Press Ctrl+C to stop the tunnel

✔ 🚀 Local tunnel is live and linked to Copilot Cloud!
```

This allows Copilot Cloud to know where to send requests to when the agent is called.

## Specify the agent to use

Now we need to let the CopilotKit provider know which agent to use, we can do this by specifying the `agent` prop.
By default, CopilotKit will intelligently route requests to the appropriate agent based on context. This allows
you to have multiple agents and actions and not have to worry about manually routing requests.

In our case however, we only have a single agent and its ideal to lock all requests to that agent. We can do this
by updating the props of our `CopilotKit` provider.

Our agent name is `agent` which is specified in the `langgraph.json` file.

```tsx title="frontend/src/app/layout.tsx"
// ...
<CopilotKit
  // ...
  agent="agent" // [!code ++]
>
  {...}
</CopilotKit>
```

## Recap
And we're done! Here's what we did:

- We connected the agent to CopilotKit.
- We specified the agent to use.

Now when you head back to the app, you'll notice that we're talking to our LangGraph agent!

Next, let's process and sync the state between our application and the agent.

### Step 5: Human in the Loop
- Route: `/langgraph/tutorials/agent-native-app/step-5-human-in-the-loop`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/step-5-human-in-the-loop.mdx`

Now that we have the ability to chat with our agent, we can move on to implementing human-in-the-loop. This is where the user can review the agent's output and provide feedback. We'll be
implementing this in our application by allowing the user to review and approve an outline prior to the research being conducted.

## Understanding Human-in-the-Loop

In LangGraph, the current suggested way to implement human-in-the-loop is to use the [interrupt](https://docs.langchain.com/oss/python/langgraph/interrupts) method. Calling this
function will pause the node at the call site and rerun the node with the user's decision. You can learn more about interrupt [here](https://docs.langchain.com/langsmith/interrupt-concurrent).

All together, this process will look like this:

The implementation of all of this is actually quite simple, but understanding how it all fits together is key.
## Add `useLangGraphInterrupt` to the frontend

If you recall from when we started the agent, the interrupt will stop the node when its time to review a proposed research outline.

CopilotKit allows us to render a UI to get the user's decision for this interrupt and respond accordingly via the `useLangGraphInterrupt` hook.

In our `page.tsx` file, add the following code.
```tsx title="frontend/src/app/page.tsx"
// ...
import { useLangGraphInterrupt } from "@copilotkit/react-core/v2"; // [!code ++]
// ...

export default function HomePage() {
    // ...
    const { state: researchState, setResearchState } = useResearch()

    const streamingSection = useStreamingContent(researchState);

    // [!code ++:12]
    useLangGraphInterrupt<Proposal>({
      render: ({ resolve, event }) => {
        return <ProposalViewer
          proposal={event.value}
          onSubmit={(approved, proposal) => resolve(
            JSON.stringify({
              ...proposal,
              approved,
            })
          )}
        />
      }
    })
    // ...
}
```

Now, when the LangGraph is interrupted the `ProposalViewer` component will be rendered to the user with the `event.value` as the proposal. On submit, the hook's `resolve` function
will be called with the user's decision.

Checkout the `ProposalViewer` component code in the `frontend/src/components/ProposalViewer.tsx` file for more details about rendering.

It's just a standard React component with some styling, a form, and a submit button.

## Recap
It is really as simple as that! Now, we've implemented human-in-the-loop for our agent. To recap, we did the following:
- Learned about human-in-the-loop in LangGraph.
- Added the `useLangGraphInterrupt` hook to our application.
- Rendered a `ProposalViewer` component to the user in the chat

Try asking the agent to research something, like Dogs. Eventually you'll see it ask you for feedback about the proposal.

```
Please research dogs!
```

Now, we can completely run our agent from start to finish to conduct research. However, you may notice that the research does not populate in the right window
as it completes. In the next step, we'll leverage the CoAgent concept of shared state to populate the research in the right window.

### Step 6: Shared State
- Route: `/langgraph/tutorials/agent-native-app/step-6-shared-state`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/step-6-shared-state.mdx`

In LangGraph, your agents are stateful. This means that they as your graph traverses nodes, the overall application state will be updated and persisted.

CopilotKit allows you to easily read and update this state through the use of two main hooks:
- [`useCoAgent`](/reference/v1/hooks/useCoAgent) - Provides a way to read and write Agent state anywhere in your application.
- [`useCoAgentStateRender`](/reference/v1/hooks/useCoAgentStateRender) - Provides a way to render Agent state in the chat.

With this in mind, our current goal is to create a bidirectional connection between the application's state and the LangGraph agent's state. This will
allow us to render the agent's completed research in the right panel.

For this, we'll be using the `useCoAgent` hook.

The `useCoAgentStateRender` will be used in the next step to render the agent's progress in the chat.

## Understanding our agent's state
The state of our agent can be found in `agent/state.py`.

```python title="agent/state.py"
# ...
from typing import Dict, Union, List
from langgraph.graph import MessagesState

class ResearchState(MessagesState):
    title: str
    proposal: Dict[str, Union[str, bool, Dict[str, Union[str, bool]]]]  # Stores proposed structure before user approval
    outline: dict
    sections: List[dict]  # list of dicts with 'title','content',and 'idx'
    footnotes: str
    sources: Dict[str, Dict[str, Union[str, float]]]
    tool: str
    logs: List[dict]  # list of dicts logs to be sent to frontend with 'message', 'status'
```

There are a few things to note here, but let's focus on the `proposal` field and `sections` field.

- The `proposal` field is a dictionary that stores the proposed research structure before the user approves it.
- The `sections` field is a list of dictionaries, each containing a `title`, `content`, and `idx`. This is the actual research that will be displayed in the right panel.

We've already wired up the approval of the `proposal` field in the previous step, so now we need to wire up rendering for the `sections` field.

## The `useCoAgent` hook
Our current goal is to create a bidirectional connection between these two states. Luckily, the [`useCoAgent`](/reference/v1/hooks/useCoAgent) hook makes this easy.

In the `useResearch` hook, we'll just replace our React state objects with the `useCoAgent` hook.

```tsx title="frontend/src/components/research-context.tsx" {3,8-11}
// ...
import { useAgent } from "@copilotkit/react-core/v2"; // [!code ++]
// ...

interface ResearchContextType {
    state: ResearchState;
    setResearchState: (newState: ResearchState | ((prevState: ResearchState) => ResearchState)) => void
    sourcesModalOpen: boolean
    setSourcesModalOpen: (open: boolean) => void
    runAgent: () => void
}

const ResearchContext = createContext<ResearchContextType | undefined>(undefined)

export function ResearchProvider({ children }: { children: ReactNode }) {
    const [sourcesModalOpen, setSourcesModalOpen] = useState<boolean>(false)
    // [!code ++:5]
    const { state, setState, run } = useAgent<ResearchState>({
        name: 'agent',
        initialState: {},
    });
    const [state, setState] = useState<ResearchState>({} as ResearchState) // [!code --]

    // ...

    return (
        <ResearchContext.Provider
            value={{
              state,
              setResearchState: setState as ResearchContextType['setResearchState'],
              setSourcesModalOpen,
              sourcesModalOpen,
              runAgent: run  // [!code ++]
              runAgent: () => {} // [!code --]
            }}>
            {children}
        </ResearchContext.Provider>
    )
}

export function useResearch() {
    const context = useContext(ResearchContext)
    if (context === undefined) {
        throw new Error('useResearch must be used within a ResearchProvider')
    }
    return context
}
```

The `useCoAgent` hook is generic. What this means is that we can specify a type for that represents the state of the LangGraph agent.
If you are going to specify a type, you should be very careful that the type has the same shape as the state of your LangGraph agent.

It is not recommended, but you can ditch the type parameter and instead get an `any` type.

In this example, we use the `useCoAgent` hook to wire up the application's state to the LangGraph agent's state.
- For the generic type, we pass the `AgentState` type that was already defined for the application in `@/lib/types.ts`.
- For the `name` parameter, we pass the name of the graph as defined in `agent/langgraph.json`.
- For the `initialState` parameter, we pass the initial state of the LangGraph agent which is already defined in `@/lib/trips.ts`.

## Recap
Now we can see the final result of the research in the right panel! To recap, we did the following:
- Learned about the agent's state.
- Added the `useCoAgent` hook to our application to render the `sections` field.

Now, try running the agent again and going through the same steps. At the end, you'll see the completed research in the right panel.

```
Please research dogs!
```

Now, we can completely run our agent from start to finish *and* see the finalized research in the right window.

However, you may notice that the research takes a long time to complete without any indication of progress. In the next step, we'll leverage the CoAgent concepts
of **generative ui** to communicate the agent's progress in the chat.

### Step 7: Agentic Generative UI
- Route: `/langgraph/tutorials/agent-native-app/step-7-generative-ui`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/step-7-generative-ui.mdx`

We're almost done! In this step, we're going to add generative UI to the application so that we can visualize the agent
state in the chat UI. The end goal with this is to allow the user to see the progress of the agent's research as it is
completed.

We call UI that is rendered from the state of the agent or its tool calls "Generative UI".

For this guide, we're going to start using the CopilotKit SDK to emit the state of the agent manually. This is because
in LangGraph, state is only updated when a node change occurs (i.e, an edge is traversed).

As such, in-progress work is not emitted to the user by default. However, we can manually emit the state using the `copilotkit_emit_state`
function. With that emitted state, we'll be using the `useCoAgentStateRender` hook to render updates in the chat to give the user
a sense of progress.

## CopilotKit Python SDK
This tutorial already comes with the CopilotKit Python SDK installed. This allows us to utilize various CopilotKit specific
features, such as emitting state.

  **The package versions in this tutorial are pinned, so updating the dependencies could break the tutorial.**

```bash
    uv add copilotkit
```
```bash
    poetry add copilotkit
```

```bash
    pip install copilotkit --extra-index-url https://copilotkit.gateway.scarf.sh/simple/
```

```bash
    conda install copilotkit -c copilotkit-channel
```

## Manually emit state
The research ANA emits state in a variety of places. For the sake of simplicity, we'll be adding the `copilotkit_emit_state` function
to the `agent/graph.py` file so you can understand how it works. However, state is also emitted in the following files if you'd like to
look at them:
- `agent/tools/outline_writer.py`
- `agent/tools/section_writer.py`
- `agent/tools/tavily_extract.py`
- `agent/tools/tavily_search.py`

Each of these files will write their progress to the `logs` field of the agent's state. Directly after that, we call `copilotkit_emit_state` to emit the state to the frontend.

For example, in the `tool_node` we update some state based on the tool result and then use `copilotkit_emit_state` to emit the state to the frontend.

```python title="agent/graph.py"
# ...
from copilotkit.langchain import copilotkit_emit_state # [!code ++]
#...

async def tool_node(self, state: ResearchState, config: RunnableConfig) -> Command[Literal["process_feedback_node", "call_model_node"]]:
        # ...
        for tool_call in state["messages"][-1].tool_calls:
            # ...

            tool_state = {
                "title": new_state.get("title", ""),
                "outline": new_state.get("outline", {}),
                "sections": new_state.get("sections", []),
                "sources": new_state.get("sources", {}),
                "proposal": new_state.get("proposal", {}),
                "logs": new_state.get("logs", []),
                "tool": new_state.get("tool", {}),
                "messages": msgs
            }
            await copilotkit_emit_state(config, tool_state) # [!code ++]

        return tool_state
```

As this loop is iterated through, the intermediate state that the tools write will be emitted to the frontend. Basically, any time that
you want to emit state to the frontend, you can do so by calling `copilotkit_emit_state`.

## Render the emitted state
Now, our state is being emitted to the frontend. However, we need to render it in the chat. To do this, we'll be using the `useCoAgentStateRender` hook.

```tsx title="frontend/src/app/layout.tsx"
import { useCoAgentStateRender, useLangGraphInterrupt } from "@copilotkit/react-core/v2"; // [!code ++]

export default function HomePage() {
    //...
    const { state: researchState, setResearchState } = useResearch()
    // ...

    // [!code ++:10]
    useCoAgentStateRender<ResearchState>({
        name: 'agent',
        render: ({ state }) => {
            if (state.logs?.length > 0) {
                return <Progress logs={state.logs} />;
            }
            return null;
        },
    }, [researchState]);

    // ...
}
```

## Recap
Try running the agent again and going through the same steps. You'll now notice that the state is streaming intermediately and
the user can see the progress of the agent's research.

```
Please research dogs!
```

To recap, we did the following:
- Learned about how to emit state whenever we want with `copilotkit_emit_state`.
- Added the `useCoAgentStateRender` hook to our application to render the intermediate state in the chat.

We're almost done, just one step to go! Now we're going to learn about **progressive state updates** which will allow us to render the sections as they are written into state. This will
complete the agentic experience.

### Step 8: Progressive State Updates
- Route: `/langgraph/tutorials/agent-native-app/step-8-progressive-state-updates`
- Source: `docs/content/docs/integrations/langgraph/tutorials/agent-native-app/step-8-progressive-state-updates.mdx`

At this point, we've got a pretty functional application. We can run the agent, see the progress in the chat, and see the final research in the right panel.

However, we're still missing one thing. We don't see the LLM actually generating the research, we just see the final result.

In this step, we'll learn how to leverage predictive state rendering to render the agent's progress in the chat. Specifically, we'll be rendering the
sections of the research as they are generated.

For this, we'll be using the `copilotkit_customize_config`.

The `copilotkit_customize_config` function will be used in the next step to render the agent's progress in the chat.

## Create a copilotkit_customize_config and emit intermediate state
CopilotKit allows you to customize the configuration of how your frontend and agent interact with each other. In this case, we want to
setup the `emit_intermediate_state` property. We define a list of objects which will be used to emit the state to the frontend based on
tool calls.

```python title="agent/section_writer.py"
from copilotkit.langchain import copilotkit_customize_config, copilotkit_emit_state // [!code ++]

# ...
@tool("section_writer", args_schema=SectionWriterInput, return_direct=True)
async def section_writer(research_query, section_title, idx, state):
    """Writes a specific section of a research report based on the query, section title, and provided sources."""

    # ...

    # Define the state keys that we want to emit, pre-created for this tutorial
    content_state = {
        "state_key": f"section_stream.content.{idx}.{section_id}.{section_title}",
        "tool": "WriteSection",
        "tool_argument": "content"
    }
    footer_state = {
        "state_key": f"section_stream.footer.{idx}.{section_id}.{section_title}",
        "tool": "WriteSection",
        "tool_argument": "footer"
    }

    # [!code ++:5]
    config = copilotkit_customize_config(
        config,
        emit_intermediate_state=[content_state, footer_state]
    )

    # ...

    # [!code highlight:3]
    # The LLM will take this new config and the tool calls
    # we defined will be emitted to the frontend predictively.
    response = await model.bind_tools([WriteSection]).ainvoke(lc_messages, config)

    # ...

```

There are three main pieces to predictively emit state:
1. The `state_key` is the key of the agent's state that we want to emit.
2. The `tool` is the tool that will be called to generate the state.
3. The `tool_argument` is the argument that will be passed to the tool which will be the predicted state.

## Recap
That's it! Now when the LLM calls the tools that we defined, the state will be predictively emitted to the frontend.

To give it a try, go through the full flow of conducting research. You'll now be able to see the sections as they are being generated.

```
Please research dogs!
```

To recap, we did the following:
- Learned about the `copilotkit_customize_config` function.
- Used the config to emit the state of the agent predictively

You've successfully created a CoAgent using the core concepts of CopilotKit. In the next step, we'll wrap up this tutorial by recapping the entire process
and showing some next steps.

### Overview
- Route: `/langgraph/tutorials/ai-travel-app`
- Source: `docs/content/docs/integrations/langgraph/tutorials/ai-travel-app/index.mdx`

# AI Travel Agentic Copilot Tutorial

## What you'll learn

In this tutorial, you will take a simple travel application and supercharge it with an agentic copilot. You will learn:

- 💡 What an agentic copilot is and how it can be used to enhance your application
- 💡 How to use `useCoAgent` to allow for shared state between your UI and agent execution
- 💡 How to use `useCoAgentStateRender` to implement human-in-the-loop workflows
- 💡 How to render intermediate states of your agent's execution

In the next step, we'll checkout the repo, install dependencies, and start the project locally.

### Next Steps
- Route: `/langgraph/tutorials/ai-travel-app/next-steps`
- Source: `docs/content/docs/integrations/langgraph/tutorials/ai-travel-app/next-steps.mdx`

This is the end of the tutorial. You can now start building your own CoAgents into your appications!

## Source code

You can find the source code and interactive sandboxes here:
- [Start app](https://github.com/CopilotKit/CopilotKit/tree/coagents-travel-tutorial-start/examples/coagents-travel)
- [Final app](https://github.com/CopilotKit/CopilotKit/tree/main/examples/coagents-travel)

## What's next?

For next steps, here are some ideas:

- Add suggestions to your copilot, using the [`useCopilotChatSuggestions`](/reference/v1/hooks/useCopilotChatSuggestions) hook.
- Implement a custom UI for your agent, using the [`useCopilotChat`](/reference/v1/hooks/useCopilotChat) hook.
- Add human editing of tool call arguments to the human in the loop implementation.

We have more tutorials coming soon.

## Need help?

If you have any questions, feel free to reach out to us on [Discord](https://discord.gg/6dffbvGU3D).

### Step 1: Checkout the repo
- Route: `/langgraph/tutorials/ai-travel-app/step-1-checkout-repo`
- Source: `docs/content/docs/integrations/langgraph/tutorials/ai-travel-app/step-1-checkout-repo.mdx`

### Checkout the starting branch
We'll be working with the CopilotKit repository, specifically using a branch called `coagents-travel-tutorial-start`. This branch contains the starting code for our travel app tutorial.

```shell
git clone -b coagents-travel-tutorial-start https://github.com/CopilotKit/CopilotKit.git
cd CopilotKit
```

The tutorial code is located in the `examples/coagents-travel` directory, which contains:
- `ui/`: A NextJS application where we'll integrate our LangGraph agent
- `agent/`: A Python-based LangGraph agent that we'll be enhancing

Go ahead and navigate to the example directory:

```shell
cd examples/coagents-travel
```
### Install dependencies
First, let's set up the NextJS application. Navigate to the `ui` directory and install the dependencies:

```shell
cd ui
pnpm install
```
### Start the project
Launch the development server:

```shell
pnpm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to see the travel app in action. Take some time to explore the interface and familiarize yourself with its features.

Next, let's understand the LangGraph agent and how it works.

### Step 2: LangGraph Agent
- Route: `/langgraph/tutorials/ai-travel-app/step-2-langgraph-agent`
- Source: `docs/content/docs/integrations/langgraph/tutorials/ai-travel-app/step-2-langgraph-agent.mdx`

Before we start integrating the LangGraph agent, let's understand how it works.

For the sake of this tutorial we won't be building the LangGraph together from scratch.
Instead, we'll be using the LangGraph constructed in the `agent/` directory.

If you're interested in a step-by-step guide for building a LangGraph agent, you can checkout the
[LangGraph quickstart guide](https://docs.langchain.com/oss/python/langgraph/quickstart).

Let's walk through the LangGraph agent to understand how it works before we integrate it into the application.

### Install LangGraph Studio

LangGraph Studio is a tool for visualizing and debugging LangGraph workflows. It is not required for using CopilotKit but it is highly recommended
for understanding how LangGraph works.

To install LangGraph Studio, checkout the [setup guide](https://studio.langchain.com/).

### Retreive API keys

For this application, we'll need two API keys:
- OpenAI API key: You can get an API key from the OpenAI console [here](https://platform.openai.com/api-keys).
- Google Maps API key: This can be retrieved from the Google Cloud Console [here](https://developers.google.com/maps/documentation/places/web-service/get-api-key#creating-api-keys).

### Setup the .env file

In a new terminal, navigate to the agent directory.

```shell
cd examples/coagents-travel/agent
```

Now create a .env file there.

```shell
touch .env
```

With that created, we'll want to add your OPENAI_API_KEY and GOOGLE_MAPS_API_KEY to the file.

```txt title=".env"
OPENAI_API_KEY=<your-openai-api-key>
GOOGLE_MAPS_API_KEY=<your-google-maps-api-key>
```

### Visualizing the LangGraph Agent

With LangGraph Studio installed, you can run and visualize the LangGraph agent by opening the `examples/coagents-travel/agent/` directory in the studio.

The agent will take some time to load as things get setup but once finished it will look something like this.

![LangGraph Studio](https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/tutorials/ai-travel-app/lgs-overview.png)

### Understanding the LangGraph Agent

As we're building this agent into an agentic experience, we'll want to understand how it works. The key concepts at play here are:

- **State**: The state is the data that the agent is using to make and communicate its decisions. You can see all of the state variables in the bottom left of the screen.
- **Nodes**: Nodes are the building blocks of a LangGraph agent. They are the steps that the agent will take to complete a task. In this case, we have nodes for **chatting**, **searching** and **performing operations** on trips.
- **Edges**: Edges are the arrows that connect nodes together. They define the logic for how the agent will move from one node to the next. They are defined in code and conditional logic is handled with a `route` function.
- **Interrupts**: Interrupts are a way to allow for a user to work along side the agent and review its decisions. In this case, we have an **interrupt** before the **trips_node** which blocks the agent from proceeding until the user has approved the Agent's actions.

### Testing the LangGraph Agent

You can submit a message to the agent by adding a message to the `messages` state variable and then clicking "Submit".

You'll see the agent respond in the chat and direct appropriately through the various nodes. In this case, you should notice that the
agent calls the `search_node` and, once it has received a response, will add a new trip based on its findings to the state via the
`trips_node`.

### Understanding breakpoints
A very important concept for agentic copilots is [human-in-the-loop](/langgraph/human-in-the-loop). This is the idea that the agent should be able to pause and wait for a human to review and approve its decisions.
LangGraph allows for this by using **breakpoints**. Let's take a look at what that looks like in action.

First, click on the `trips_node` and select the `interrupt_after` option.

Now, try to have the agent create a new trip again. You'll notice that it now asks for approval before proceeding via a `continue` button.

![LangGraph Studio Progress](https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/tutorials/ai-travel-app/lgs-progress.png)

Make sure to remove the `interrupt_after` option before proceeding, this will break things later if you don't.

### Leave LangGraph Studio running

In order to create an agentic copilot, you'll need to have your LangGraph agent running somewhere. In our case, LangGraph studio is
running this locally for us. We can see this by looking at the URL at the bottom left of the application.

![LangGraph Studio URL](https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/tutorials/ai-travel-app/lgs-url.png)

Later in this tutorial, we'll be using this URL to connect CopilotKit to the LangGraph agent.

Here's what we did:
- Installed LangGraph Studio
- Setup the .env file
- Visualized the LangGraph agent
- Tested the LangGraph agent
- Left LangGraph Studio running

In the next step, we'll be integrating the LangGraph agent into the application as an agentic copilot.

### Step 3: Setup CopilotKit
- Route: `/langgraph/tutorials/ai-travel-app/step-3-setup-copilotkit`
- Source: `docs/content/docs/integrations/langgraph/tutorials/ai-travel-app/step-3-setup-copilotkit.mdx`

Now that we have the application and agent running, we're ready to connect both via CopilotKit. For this tutorial, we will install the following dependencies:

- `@copilotkit/react-core`: The core library for CopilotKit, which contains the CopilotKit provider and useful hooks.
- `@copilotkit/react-ui`: The UI library for CopilotKit, which contains the CopilotKit UI components such as the sidebar, chat popup, textarea and more.

## Install Dependencies

Navigate back to the `ui` directory and install the CopilotKit dependencies:

```shell
pnpm add @copilotkit/react-core @copilotkit/react-ui
```

## Setup CopilotKit

There are two ways of setting up CopilotKit, either by using Copilot Cloud or by self-hosting. Self-hosting will give you more control
over CopilotKit's runtime (our interface to the LLM) but will also require you to manage the extra complexity of running a server. Copilot Cloud
on the other hand is a fully managed service that you can get started with in just a few clicks.

For this tutorial, you can select either option.

We're using CopiloKit cloud as a hosted version of the CopilotKit runtime. The runtime serves as an interface between the application and the LLM
(agentic or not). Copilot Cloud will manage all of the complexity for us but in return we need to provide a valid API key.
### Create an account on Copilot Cloud

First, you'll need to create an account for Copilot Cloud [here](https://cloud.copilotkit.ai/sign-in). You can
use whatever authentication method you'd like.

### Get a Copilot Cloud API Key

Once logged in, you'll see some steps guiding you to getting our Copilot Cloud public API key. For this, you'll need an OpenAI API key since it's the only
provider currently supported (more providers coming soon!).

Set your OpenAI API key, click the green checkmark and you'll see your API key created right below the input.

### Setting up the environment variables

First, create a `.env` file in the `ui` directory.

```shell
touch ui/.env
```

Then, add your Copilot Cloud API key to the file like so:

```txt title="ui/.env"
NEXT_PUBLIC_CPK_PUBLIC_API_KEY=...
```

### Configure the CopilotKit Provider

Now we're ready to configure the CopilotKit provider in our application.

```tsx title="ui/app/page.tsx" showLineNumbers
"use client";

import { CopilotKit } from "@copilotkit/react-core/v2"; // [!code ++]

export default function Home() {
  // [!code ++:5]
  return (
    <CopilotKit
      publicApiKey={process.env.NEXT_PUBLIC_CPK_PUBLIC_API_KEY}
    >
      <TooltipProvider>
        <TripsProvider>
          <main className="h-screen w-screen">
            <MapCanvas />
          </main>
        </TripsProvider>
      </TooltipProvider>
    </CopilotKit> // [!code ++]
  );
}
```

### CopilotKit Chat Popup

We provide several plug-and-play components for you to interact with your copilot. Some of these are ``, ``, and ``. You can of course use CopilotKit in headless mode and provide your own fully custom UI via [`useCopilotChat`](/reference/v1/hooks/useCopilotChat).

In this tutorial, we'll use the `` component to display the chat sidebar.

```tsx title="ui/app/page.tsx" showLineNumbers {6-7,15}
"use client";

import { TasksList } from "@/components/TasksList";
import { TasksProvider } from "@/lib/hooks/use-tasks";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { CopilotSidebar } from "@copilotkit/react-core/v2"; // [!code ++]
import "@copilotkit/react-ui/v2/styles.css"; // [!code ++]

export default function Home() {
  return (
    <CopilotKit
      publicApiKey={process.env.NEXT_PUBLIC_CPK_PUBLIC_API_KEY}
    >
      /* [!code ++:9] */
      <CopilotSidebar
        defaultOpen={true}
        clickOutsideToClose={false}
        labels={{
          modalHeaderTitle: "Travel Planner",
          welcomeMessageText: "Hi! 👋 I'm here to plan your trips. I can help you manage your trips, add places to them, or just generally work with you to plan a new one.",
        }}
      />
      <TooltipProvider>
        <TripsProvider>
          <main className="h-screen w-screen">
            <MapCanvas />
          </main>
        </TripsProvider>
      </TooltipProvider>
    </CopilotKit>
  );
}
```

And we're done! Here's what we did:

- We setup our Copilot cloud account and got an API key.
- We configured the CopilotKit provider in our application to use our API key.
- We added the CopilotSidebar to our application.

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
```tsx title="app/page.tsx" showLineNumbers
"use client";

import { TasksList } from "@/components/TasksList";
import { TasksProvider } from "@/lib/hooks/use-tasks";
import { CopilotKit } from "@copilotkit/react-core/v2"; // [!code ++]

export default function Home() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit"> // [!code ++]
      <TasksProvider>
        <TasksList />
      </TasksProvider>
    </CopilotKit> // [!code ++]
  );
}
```

### CopilotKit Chat Popup

We provide several plug-and-play components for you to interact with your copilot. Some of these are ``, ``, and ``. You can of course use CopilotKit in headless mode and provide your own fully custom UI via [`useCopilotChat`](/reference/v1/hooks/useCopilotChat).

In this tutorial, we'll use the `` component to display the chat sidebar.

```tsx title="ui/app/page.tsx" showLineNumbers {6-7,15}
"use client";

import { TasksList } from "@/components/TasksList";
import { TasksProvider } from "@/lib/hooks/use-tasks";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { CopilotSidebar } from "@copilotkit/react-core/v2"; // [!code ++]
import "@copilotkit/react-ui/v2/styles.css"; // [!code ++]

export default function Home() {
  return (
    <CopilotKit
      publicApiKey={process.env.NEXT_PUBLIC_CPK_PUBLIC_API_KEY}
    >
      /* [!code ++:9] */
      <CopilotSidebar
        defaultOpen={true}
        clickOutsideToClose={false}
        labels={{
          modalHeaderTitle: "Travel Planner",
          welcomeMessageText: "Hi! 👋 I'm here to plan your trips. I can help you manage your trips, add places to them, or just generally work with you to plan a new one.",
        }}
      />
      <TooltipProvider>
        <TripsProvider>
          <main className="h-screen w-screen">
            <MapCanvas />
          </main>
        </TripsProvider>
      </TooltipProvider>
    </CopilotKit>
  );
}
```

Here's what we did:

- We imported the `` component from `@copilotkit/react-ui`.
- We wrapped the page with the `` provider.
- We imported the built-in styles from `@copilotkit/react-ui`.

Now, head back to the app and you'll find a chat sidebar on the left side of the page. At this point, you can start interacting with your copilot! 🎉

This is very exciting! In the next step we'll be making this copilot agentic through the use of LangGraph.

### Step 4: Integrate the Agent
- Route: `/langgraph/tutorials/ai-travel-app/step-4-integrate-the-agent`
- Source: `docs/content/docs/integrations/langgraph/tutorials/ai-travel-app/step-4-integrate-the-agent.mdx`

At this point, we have a LangGraph agent running in LangGraph Studioand have our own non-agentic copilot that we can interact with. Now, let's
combine the two together to make an agentic copilot!

## The React State

Let's quickly review how the app's state works. Open up the [`lib/hooks/use-trips.tsx`](https://github.com/CopilotKit/CopilotKit/blob/coagents-travel-tutorial-start/examples/coagents-travel/ui/lib/hooks/use-trips.tsx) file.

At a glance, we can see that the file exposes a provider (`TripsProvider`), which defines a lot useful things. The main thing we care about is the `state` object which takes the shape of the `AgentState` type. This is consumable by a `useTrips` hook, which we use in the rest of the application (feel free to check out the `TripCard`,
`TripContent` and `TripSelect` components).

This resembles the majority of React apps, where frontend state, either for a feature or the entire app, is managed by a context or state management library.

## Integrate the Agent

To integrate the agent into this state, we're going to need to register an agent with CopilotKit and then use the `useCoAgent` hook to connect the two.

## Register the agent

Make sure you have the LangGraph Studio endpoint from the previous step!

We're going to use the CopilotKit CLI to setup a tunnel between our locally running LangGraph agent and Copilot Cloud. You'll
need the port number of the LangGraph Studio endpoint we setup earlier.

It'll be on the bottom left of the LangGraph Studio interface like this.

To open a tunnel, run the following command.

```bash
# replace <port_number> with the port number of the LangGraph Studio endpoint
npx copilotkit@latest dev --port <port_number>
```

It will guide you through the process of selecting a project and creating a tunnel. You should see output similar to the following.

```bash
✔ Select a project Local (ID: <project_id>)
✅ LangGraph Platform endpoint detected
⠹ Creating tunnel...

Tunnel Information:

• Tunnel URL:            https://<tunnel_id>.tunnels.devcopilotkit.com
• Endpoint Type:         LangGraph Platform
• Project:               projects/<project_id>

Press Ctrl+C to stop the tunnel

✔ 🚀 Local tunnel is live and linked to Copilot Cloud!
```

In our previously setup `/api/copilotkit` route, we're going to add the following.

```tsx title="ui/app/api/copilotkit/route.ts"
// ...

import { CopilotRuntime, LangGraphAgent } from '@copilotkit/runtime'; // [!code ++]

// ...

const runtime = new CopilotRuntime();// [!code --]
// [!code ++:10]
const runtime = new CopilotRuntime({
  // [!code highlight:7]
  agents: {
    'travel': new LangGraphAgent({
      deploymentUrl: "http://localhost:<port_number>",
      graphId: 'travel',
      langsmithApiKey: "your-langsmith-api-key" // Optional
    }),
  },
});

// ...
```

The `deploymentUrl` is the URL from LangGraph Studio but it can also be a graph hosted in LangGraph Platform!

This allows CopilotKit to know where to send requests to when the agent is called.

## Lock the agent

By default, CopilotKit will intelligently route requests to the appropriate agent based on context. This allows
you to have multiple agents and actions and not have to worry about manually routing requests.

In our case however, we only have a single agent and its ideal to lock all requests to that agent. We can do this
by updating the props of our `CopilotKit` provider.

```tsx title="ui/app/page.tsx"
// ...
<CopilotKit
  // ...
  agent="travel" // [!code ++]
>
  {...}
</CopilotKit>
```

This will ensure that every request is sent to the `travel` agent. The `travel` name is defined in the [agents/langgraph.json](https://github.com/CopilotKit/CopilotKit/blob/main/examples/coagents-travel/agent/langgraph.json)
file. When we deploy our agent to Copilot Cloud this is automatically handled for us. When self-hosting, we need to specify the name of the agent in the `langGraphPlatformEndpoint` constructor.

## The `useCoAgent` hook

LangGraph agents are stateful, meaning that they can maintain their own state. We saw this earlier when we were using LangGraph Studio, in the bottom left. We
also have the application's state through React.

Our current goal is to create a bidirectional connection between these two states. Luckily, the [`useCoAgent`](/reference/v1/hooks/useCoAgent) hook makes this easy.

```tsx title="ui/lib/hooks/use-trips.tsx" {3,8-11}
// ...
// [!code word:AgentState:1]
import { Trip, Place, AgentState, defaultTrips} from "@/lib/trips";
import { useAgent } from "@copilotkit/react-core/v2"; // [!code ++]

export const TripsProvider = ({ children }: { children: ReactNode }) => {
  // [!code --:5]
  const [state, setState] = useState<{ trips: Trip[], selected_trip_id: string | null }>({
    trips: defaultTrips,
    selected_trip_id: defaultTrips && defaultTrips[0] ? defaultTrips[0].id : null
  });
  // [!code ++:9]
  const { state, setState } = useAgent<AgentState>({
    name: "travel",
    initialState: {
      trips: defaultTrips,
      selected_trip_id: defaultTrips[0].id,
    },
  });

  // ...
```

The `useCoAgent` hook is generic. What this means is that we can specify a type for that represents the state of the LangGraph agent.
If you are going to specify a type, you should be very careful that the type has the same shape as the state of your LangGraph agent.

It is not recommended, but you can ditch the type parameter and instead get an `any` type.

In this example, we use the `useCoAgent` hook to wire up the application's state to the LangGraph agent's state.
- For the generic type, we pass the `AgentState` type that was already defined for the application in `@/lib/types.ts`.
- For the `name` parameter, we pass the name of the graph as defined in `agent/langgraph.json`.
- For the `initialState` parameter, we pass the initial state of the LangGraph agent which is already defined in `@/lib/trips.ts`.

## Try it out!

Now, try it out! Ask the Copilot something about the state of your trips. For example:

```
What trips do I currently have?
```

The state is shared between the application and the agent, so you can edit a trip manually, ask the same question,
and the agent will know about it.

```
What trips do I have now?
```

In the same vein, you can ask the agent to update your trips and it will render in the UI. For example:

```
Add some hotels to my NYC trip
```

Its really that simple, you have now integrated a LangGraph agent into the application as an agentic copilot. In the following
steps, we'll be improving the user experience but the core agent is now accessible through the application's chat interface.

### Step 5: Stream Progress
- Route: `/langgraph/tutorials/ai-travel-app/step-5-stream-progress`
- Source: `docs/content/docs/integrations/langgraph/tutorials/ai-travel-app/step-5-stream-progress.mdx`

Now that we have integrated the LangGraph agent into the application, we can start utilizing features that will enhance the
user agentic experience even further. For example, what if we could stream the progress of a search to the user?

In this step, we'll be doing just that. To do so we'll be using the `copilotkit_emit_state` CopilotKit SDK function in the
`search_node` of our LangGraph agent.

## Install the CopilotKit SDK

CopilotKit comes ready with an SDK for building both Python and Typescript agents. In this case, the agent is written in Python
(manged with `poetry`), so we'll be installing the Python SDK.

Don't have poetry installed? [Install it here](https://python-poetry.org/docs/#installation).

```shell title="agent/"
poetry add copilotkit
# or including support for crewai
poetry add copilotkit[crewai]
```

Now we're ready to use the CopilotKit SDK in our agent! Since we're editing the `search_node` in agent, we'll be
editing the `search.py` file.

## Manually emitting the agent's state

With CoAgents, the LangGraph agent's state is only emitted when node change occurs (i.e, an edge is traversed). This means
that in-progress work is not emitted to the user by default. However, we can manually emit the state using the `copilotkit_emit_state`
function that we mentioned earlier.

### Add the custom CopilotKit config to the `search_node`
First, we're going to add a custom copilotkit config to the `search_node` to describe what intermediate state
we'll be emitting.

```python title="agent/travel/search.py" {3-5}
# ...
from copilotkit.langgraph import copilotkit_emit_state, copilotkit_customize_config # [!code ++]

async def search_node(state: AgentState, config: RunnableConfig):
    """
    The search node is responsible for searching the for places.
    """
    ai_message = cast(AIMessage, state["messages"][-1])

    # [!code ++:9]
    config = copilotkit_customize_config(
        config,
        emit_intermediate_state=[{
            "state_key": "search_progress",
            "tool": "search_for_places",
            "tool_argument": "search_progress",
        }],
    )

    # ...
```
### Emit the intermediate state
Now we can call `copilotkit_emit_state` to emit the intermediate state wherever we want. In this case, we'll be emitting it
progress at the beginning of our search and as we receive results.

One piece of this that has already been setup for you is the `search_progress` state key. In order to emit progress, we add
an object to our state that we'll manually update with the results and progress of our search. Then we'll be calling `copilotkit_emit_state`
to manually emit that state.

```python title="agent/travel/search.py"
# ...
async def search_node(state: AgentState, config: RunnableConfig):
    """
    The search node is responsible for searching the for places.
    """
    ai_message = cast(AIMessage, state["messages"][-1])

    config = copilotkit_customize_config(
        config,
        emit_intermediate_state=[{
            "state_key": "search_progress",
            "tool": "search_for_places",
            "tool_argument": "search_progress",
        }],
    )

    # ^ Previous code

    state["search_progress"] = state.get("search_progress", [])
    queries = ai_message.tool_calls[0]["args"]["queries"]

    for query in queries:
        state["search_progress"].append({
            "query": query,
            "results": [],
            "done": False
        })

    await copilotkit_emit_state(config, state) # [!code ++]

    # ...
```

Now the state of our search will be emitted through the `search_progress` state key to CopilotKit! However, we still need to update this
state as we receive results from our search.

```python title="agent/travel/search.py"
# ...
async def search_node(state: AgentState, config: RunnableConfig):
    """
    The search node is responsible for searching the for places.
    """
    ai_message = cast(AIMessage, state["messages"][-1])

    config = copilotkit_customize_config(
        config,
        emit_intermediate_state=[{
            "state_key": "search_progress",
            "tool": "search_for_places",
            "tool_argument": "search_progress",
        }],
    )

    state["search_progress"] = state.get("search_progress", [])
    queries = ai_message.tool_calls[0]["args"]["queries"]

    for query in queries:
        state["search_progress"].append({
            "query": query,
            "results": [],
            "done": False
        })

    await copilotkit_emit_state(config, state)

    # ^ Previous code

    places = []
    for i, query in enumerate(queries):
        response = gmaps.places(query)
        for result in response.get("results", []):
            place = {
                "id": result.get("place_id", f"{result.get('name', '')}-{i}"),
                "name": result.get("name", ""),
                "address": result.get("formatted_address", ""),
                "latitude": result.get("geometry", {}).get("location", {}).get("lat", 0),
                "longitude": result.get("geometry", {}).get("location", {}).get("lng", 0),
                "rating": result.get("rating", 0),
            }
            places.append(place)
        state["search_progress"][i]["done"] = True
        await copilotkit_emit_state(config, state) # [!code ++]

    state["search_progress"] = []
    await copilotkit_emit_state(config, state) # [!code ++]

    # ...

```

## Recieving and rendering the manaully emitted state

Now that we are manually emitting the state of our search, we can recieve and render that state in the UI. To do this,
we'll be using the [useCoAgentStateRender](/reference/v1/hooks/useCoAgentStateRender) function in our `use-trips.tsx` hook.

All we need to do is tell CopilotKit to conditionally render the `search_progress` state key through the `useCoAgentStateRender` hook.

```tsx title="ui/lib/hooks/use-trips.tsx"
// ...
import { useAgent } from "@copilotkit/react-core/v2"; // [!code --]
import { useAgent, useCoAgentStateRender } from "@copilotkit/react-core/v2"; // [!code ++]
import { SearchProgress } from "@/components/SearchProgress"; // [!code ++]

export const TripsProvider = ({ children }: { children: ReactNode }) => {
  // ...

  const { state, setState } = useAgent<AgentState>({
    name: "travel",
    initialState: {
      trips: defaultTrips,
      selected_trip_id: defaultTrips[0].id,
    },
  });

  // [!code ++:10]
  useCoAgentStateRender<AgentState>({
    name: "travel",
    render: ({ state }) => {
      if (state.search_progress) {
        return <SearchProgress progress={state.search_progress} />
      }
      return null;
    },
  });

  // ...
}

```

The `` component is a custom component that was created for you ahead of time. If you'd like to
learn more about it feel free to check it out in `ui/components/SearchProgress.tsx`!

One other thing done for you ahead of time is that the `search_progress` key is already present in the `AgentState` type. You
can look at that type in `ui/lib/types.ts`.

Give it a try! Ask the agent to search for places and we'll see the progress of each search as it comes in.

The final step is to add human in the loop to the application to allow the user to approve or reject mutative actions the
agent wants to perform.

### Step 6: Human in the Loop
- Route: `/langgraph/tutorials/ai-travel-app/step-6-human-in-the-loop`
- Source: `docs/content/docs/integrations/langgraph/tutorials/ai-travel-app/step-6-human-in-the-loop.mdx`

Now its time to add human in the loop to the application. This will allow the user to approve, reject, or modify mutative actions the
agent wants to perform. For simplicity, we'll be only implementing approve and reject actions in this step.

Our plan is to add a "breakpoint" to the application. This is a LangGraph concept that will force the agent to pause and wait for the
human approval before continuing execution.

You can learn more about breakpoints [here](https://docs.langchain.com/oss/python/langgraph/interrupts#debugging-with-interrupts).

The breakpoint will then be communicated to our front-end which we'll use to render and take the user's decision. Finally, the user's
decision will be communicated back to the agent and execution will continue.

All together, this process will look like this:

If you'd like to learn even more about human in the loop before proceeding, checkout our [Human in the Loop concept guide](/langgraph/human-in-the-loop).

Otherwise, let's get started!

## Add the breakpoint to the `trips_node`

The way that this LangGraph has been implemented allows for easy human in the loop integration. Essentially, we have a `trips_node`
that serves as a proxy to the `perform_trips_node`. This means that we can block entrance to the `perform_trips_node` by adding a breakpoint
to the `trips_node`. This will then force the agent to pause and wait for the human to approve the action before execution can continue.

To add a breakpoint to the agent, we'll be editing the graph definition in the `agent/travel/agent.py` file.

At the very bottom of the file, add the following line to the `compile` function:
```python title="agent/travel/agent.py"
# ...

graph = graph_builder.compile(
    checkpointer=MemorySaver(),
    interrupt_after=["trips_node"], # [!code ++]
)
```

This will force the agent to pause execution at the `trips_node` and wait for the human to approve the action before continuing.
## Update the perform_trips_node node to properly handle the user's decision

Prior to this step, entrance to the `perform_trips_node` was standard. We would recieve the requested tool call, call the appropriate
tool, edit the message state to reflect the tool call results, and then move on to the next node.

However, this will no longer work since we've added a breakpoint to the `trips_node`. In a future step, we'll be utilizing this
breakpoint to render a UI to the user for approval or rejection. Their decision will be communicated back via the message state.

In this step, we'll be retrieving that decison from the message state and acting accordingly.

First, let's grab the tool call message and the tool call being requested.

```python title="agent/travel/trips.py"
# ...

async def perform_trips_node(state: AgentState, config: RunnableConfig):
    """Execute trip operations"""
    ai_message = state["messages"][-1] # [!code --]
    ai_message = cast(AIMessage, state["messages"][-2]) # [!code ++]
    tool_message = cast(ToolMessage, state["messages"][-1]) # [!code ++]

    # ...
```

Now, let's add a conditional that will check the user's decision and act accordingly.

```python title="agent/travel/trips.py"
from copilotkit.langchain import copilotkit_emit_message # [!code ++]

# ...
async def perform_trips_node(state: AgentState, config: RunnableConfig):
    """Execute trip operations"""
    ai_message = cast(AIMessage, state["messages"][-2])
    tool_message = cast(ToolMessage, state["messages"][-1])

    # [!code ++:8]
    if tool_message.content == "CANCEL":
      await copilotkit_emit_message(config, "Cancelled operation of trip.")
      return state

    # handle the edge case where the AI message is not an AIMessage or does not have tool calls, should never happen.
    if not isinstance(ai_message, AIMessage) or not ai_message.tool_calls:
        return state

    # ...
```

In this case, we are checking if the user decided to cancel the operation. If so, we emit a message to the UI and return the state. Any
other decision returned will result in the requested actions being performed.

## Emitting the tool calls
In order for the front-end to recieve the breakpoint and take the user's decision, we'll need to emit the tool calls that the agent is requesting.
To do this, we'll be editing the `chat_node` in the `chat.py` file.
```python title="agent/travel/chat.py"
# ...
from copilotkit.langchain import copilotkit_customize_config # [!code ++]
async def chat_node(state: AgentState, config: RunnableConfig):
    """Handle chat operations"""
    # [!code ++:5]
    config = copilotkit_customize_config(
        config,
        emit_tool_calls=["add_trips", "update_trips", "delete_trips"],
    )
    # ...
```
We don't want to just set True here because doing so will emit all tool calls. By specifying these, we hand are handing off tool
handling to CopilotKit. If, for example, `search_for_places` was called here then it would break the state of tool calls.
With that, our work on the agent is complete and we are ready to update the front-end to properly take and communicate the user's decision.

## Rendering the tool calls and taking the user's decision

Now we need to update the front-end to render the tool calls and emit the user's decision back to the agent. To do this,
we'll be adding `useCopilotAction` hooks for each tool call with the `renderAndWait` option.

```typescript title="ui/lib/hooks/use-trips.tsx"
// ...
import { AddTrips, EditTrips, DeleteTrips } from "@/components/humanInTheLoop"; // [!code ++]
import { useAgent, useCoAgentStateRender } from "@copilotkit/react-core/v2"; // [!code --]
import { useAgent, useCoAgentStateRender, useFrontendTool } from "@copilotkit/react-core/v2"; // [!code ++]
// ...

export const TripsProvider = ({ children }: { children: ReactNode }) => {
  // ...

  useCoAgentStateRender<AgentState>({
    name: "travel",
    render: ({ state }) => {
      return <SearchProgress progress={state.search_progress} />
    },
  });

  // [!code ++:42]
  useFrontendTool({
    name: "add_trips",
    description: "Add some trips",
    parameters: [
      {
        name: "trips",
        type: "object[]",
        description: "The trips to add",
        required: true,
      },
    ],
    renderAndWait: AddTrips,
  });

  useFrontendTool({
    name: "update_trips",
    description: "Update some trips",
    parameters: [
      {
        name: "trips",
        type: "object[]",
        description: "The trips to update",
        required: true,
      },
    ],
    renderAndWait: EditTrips,
  });

  useFrontendTool({
    name: "delete_trips",
    description: "Delete some trips",
    parameters: [
      {
        name: "trip_ids",
        type: "string[]",
        description: "The ids of the trips to delete",
        required: true,
      },
    ],
    renderAndWait: (props) => DeleteTrips({ ...props, trips: state.trips }),
  });

  // ...
```

With that, our front-end is now ready to render the tool calls and take the user's decision. One thing we glossed over
are all of the imported `humanInTheLoop` components. They're provided for the convenience of this tutorial, but we should
note one very important thing - how they send the user's decision back to the agent.

## (optional) Understanding the `humanInTheLoop` components

Let's look at the `DeleteTrips` component as an example, but the same logic applies to the `AddTrips` and `EditTrips` components.

```tsx title="ui/lib/components/humanInTheLoop/DeleteTrips.tsx"
import { Trip } from "@/lib/types";
import { PlaceCard } from "@/components/PlaceCard";
import { X, Trash } from "lucide-react";
import { ActionButtons } from "./ActionButtons"; // [!code highlight]
import { RenderFunctionStatus } from "@copilotkit/react-core/v2";

export type DeleteTripsProps = {
  args: any;
  status: RenderFunctionStatus;
  handler: any;
  trips: Trip[];
};

export const DeleteTrips = ({ args, status, handler, trips }: DeleteTripsProps) => {
  const tripsToDelete = trips.filter((trip: Trip) => args?.trip_ids?.includes(trip.id));

  return (
    <div className="space-y-4 w-full bg-secondary p-6 rounded-lg">
    <h1 className="text-sm">The following trips will be deleted:</h1>
      {status !== "complete" && tripsToDelete?.map((trip: Trip) => (
        <div key={trip.id} className="flex flex-col gap-4">
          <>
            <hr className="my-2" />
            <div className="flex flex-col gap-4">
            <h2 className="text-lg font-bold">{trip.name}</h2>
            {trip.places?.map((place) => (
              <PlaceCard key={place.id} place={place} />
            ))}
            </div>
          </>
        </div>
      ))}
      { status !== "complete" && (
        // [!code highlight:6]
        <ActionButtons
          status={status} 
          handler={handler} 
          approve={<><Trash className="w-4 h-4 mr-2" /> Delete</>} 
          reject={<><X className="w-4 h-4 mr-2" /> Cancel</>} 
        />
      )}
    </div>
  );
};
```

As you can see, this is a fairly standard component that renders the trips that will be deleted. The important part is the `ActionButtons`
component. Let's take a look at it.

```tsx title="ui/lib/components/humanInTheLoop/ActionButtons.tsx"
import { RenderFunctionStatus } from "@copilotkit/react-core/v2";
import { Button } from "../ui/button";

export type ActionButtonsProps = {
    status: RenderFunctionStatus;
    handler: any;
    approve: React.ReactNode;
    reject: React.ReactNode;
}

export const ActionButtons = ({ status, handler, approve, reject }: ActionButtonsProps) => (
  <div className="flex gap-4 justify-between">
    <Button 
      className="w-full"
      variant="outline"
      disabled={status === "complete" || status === "inProgress"} 
      onClick={() => handler?.("CANCEL")} // [!code highlight]
    >
      {reject}
    </Button>
    <Button 
      className="w-full"
      disabled={status === "complete" || status === "inProgress"} 
      onClick={() => handler?.("SEND")} // [!code highlight]
    >
      {approve}
    </Button>
  </div>
);
```

The important piece here is that the `onClick` handlers emit the user's decision back to the agent. If the user clicks the `Delete` button
then the `handler?.("SEND")` is called. If the user clicks the `Cancel` button then the `handler?.("CANCEL")` is called. This is how the
agent recieves the user's decision.

If you wanted to implement a more complex UI that allows for the human to edit the tool call arguments before sending them back to the agent,
you could do so by adding additional logic to the `onClick` handlers and the agent's handling of the tool call.

With that, we've now completed the human in the loop implementation! Try asking the agent to add, edit, or delete some trips and see it in
action.

### Video: Research Canvas
- Route: `/langgraph/videos/research-canvas`
- Source: `docs/content/docs/integrations/langgraph/videos/research-canvas.mdx`

The clip above shows [Tako](https://tako.com) powering an Agent-Native Research canvas—generating interactive visuals from its index of trusted, real-time data spanning finance, sports, politics, and more.

Dive deeper to explore Tako's [documentation](https://docs.tako.com/documentation/integrations-and-examples/langgraph-copilotkit) and their open-source [Research Canvas example](https://github.com/TakoData/tako-copilotkit) built with CopilotKit, LangGraph, Tako, and Tavily.

Explore the step-by-step walkthrough of building an agentic Research Canvas with **CopilotKit and LangGraph**. You can [run the app here](https://examples-coagents-research-canvas-ui.vercel.app/) or browse the [full source code on GitHub](https://github.com/CopilotKit/CopilotKit/blob/main/examples/coagents-research-canvas/readme.md).

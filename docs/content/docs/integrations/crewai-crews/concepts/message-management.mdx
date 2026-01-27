---
title: Message flow
icon: lucide/MessageCircle
---

Message management in CoAgents operates with CopilotKit as the "ground truth" for the full chat session.
When an CoAgent session begins, it receives the existing CopilotKit chat history to maintain conversational
continuity across different agents.

<Callout>
  While all of this information is great to know, in most cases you won't need
  to worry about these details to build rich agentic applications. Use the
  information here as a reference when getting really deep into the CoAgent
  internals.
</Callout>

### Can I modify the message history?

You can modify the message history from CrewAI Flows by using the `"messages"` key in the state. For example to remove all messages from the chat history:

```python

def a_flow_function():
    # ...
    self.state["messages"] = []
```

### Can I persist chat history?

Yes! There are a few ways to persist various portions of a chat's history:

- [Threads](/crewai-crews/persistence/threads)
- [Message Persistence](/crewai-crews/persistence/message-persistence)
- [Agent State](/crewai-crews/persistence/loading-agent-state)

## Types of LLM Messages

Modern LLM interactions produce two distinct types of messages:

1. **Communication Messages**: Direct responses and interactions with users
2. **Internal Messages**: Agent "thoughts" and reasoning processes

A well known example of this pattern is OpenAI's o1 model, which has sophisticated reasoning capabilities and thoughts. Its internal
thought processes are presented distinctly from 'communication messages' which are clearly visible to the end-user.

CrewAI agents can operate similarly. An LLM call's output can be considered either a communication message, or an internal message.

### Emitting Messages for long running tasks

Sometimes you'll have a task that is running for a long time, and you want the user to be aware of what's happening.
CopilotKit allows you to accomplish this by using the `copilotkit_emit_message` function.

```python
@listen("route_to_ask_name")
async def ask_name():
    """
    Ask the user for their name.
    """

    content = "Hey, what is your name? 🙂"

    await copilotkit_emit_message(content)

    # something long running here...

    self.state["messages"].append({"role": "assistant", "content": content, "id": str(uuid.uuid4())})

```

Want some more help managing messages in your CoAgent application? Check out our guide on [emitting messages](/crewai-crews/advanced/emit-messages).

## Message Flow

Messages flow between CopilotKit and CrewAI in a specific way:

- All messages from CrewAI are forwarded to CopilotKit
- On a fresh agent invocation, the full CopilotKit chat history is provided to the CrewAI agent as its pre-existing chat history.

When a CoAgent completes its execution, its relevant messages become part of CopilotKit's persistent chat history. This allows for all future agent invocations to get context from the full chat history.

---
title: "Types"
description:
  "Documentation for the core types used in the Agent User Interaction Protocol
  Python SDK"
---

# Core Types

The Agent User Interaction Protocol Python SDK is built on a set of core types
that represent the fundamental structures used throughout the system. This page
documents these types and their properties.

## RunAgentInput

`from ag_ui.core import RunAgentInput`

Input parameters for running an agent. In the HTTP API, this is the body of the
`POST` request.

```python
class RunAgentInput(ConfiguredBaseModel):
    thread_id: str
    run_id: str
    parent_run_id: Optional[str] = None
    state: Any
    messages: List[Message]
    tools: List[Tool]
    context: List[Context]
    forwarded_props: Any
```

| Property          | Type            | Description                                    |
| ----------------- | --------------- | ---------------------------------------------- |
| `thread_id`       | `str`           | ID of the conversation thread                  |
| `run_id`          | `str`           | ID of the current run                          |
| `parent_run_id`   | `Optional[str]` | (Optional) ID of the run that spawned this run |
| `state`           | `Any`           | Current state of the agent                     |
| `messages`        | `List[Message]` | List of messages in the conversation           |
| `tools`           | `List[Tool]`    | List of tools available to the agent           |
| `context`         | `List[Context]` | List of context objects provided to the agent  |
| `forwarded_props` | `Any`           | Additional properties forwarded to the agent   |

## Message Types

The SDK includes several message types that represent different kinds of
messages in the system.

### Role

`from ag_ui.core import Role`

Represents the possible roles a message sender can have.

```python
Role = Literal["developer", "system", "assistant", "user", "tool", "activity", "reasoning"]
```

### DeveloperMessage

`from ag_ui.core import DeveloperMessage`

Represents a message from a developer.

```python
class DeveloperMessage(BaseMessage):
    role: Literal["developer"]
    content: str
```

| Property  | Type                   | Description                                      |
| --------- | ---------------------- | ------------------------------------------------ |
| `id`      | `str`                  | Unique identifier for the message                |
| `role`    | `Literal["developer"]` | Role of the message sender, fixed as "developer" |
| `content` | `str`                  | Text content of the message (required)           |
| `name`    | `Optional[str]`        | Optional name of the sender                      |

### SystemMessage

`from ag_ui.core import SystemMessage`

Represents a system message.

```python
class SystemMessage(BaseMessage):
    role: Literal["system"]
    content: str
```

| Property  | Type                | Description                                   |
| --------- | ------------------- | --------------------------------------------- |
| `id`      | `str`               | Unique identifier for the message             |
| `role`    | `Literal["system"]` | Role of the message sender, fixed as "system" |
| `content` | `str`               | Text content of the message (required)        |
| `name`    | `Optional[str]`     | Optional name of the sender                   |

### AssistantMessage

`from ag_ui.core import AssistantMessage`

Represents a message from an assistant.

```python
class AssistantMessage(BaseMessage):
    role: Literal["assistant"]
    content: Optional[str] = None
    tool_calls: Optional[List[ToolCall]] = None
```

| Property     | Type                       | Description                                      |
| ------------ | -------------------------- | ------------------------------------------------ |
| `id`         | `str`                      | Unique identifier for the message                |
| `role`       | `Literal["assistant"]`     | Role of the message sender, fixed as "assistant" |
| `content`    | `Optional[str]`            | Text content of the message                      |
| `name`       | `Optional[str]`            | Name of the sender                               |
| `tool_calls` | `Optional[List[ToolCall]]` | Tool calls made in this message                  |

### UserMessage

`from ag_ui.core import UserMessage`

Represents a message from a user.

```python
class UserMessage(BaseMessage):
    role: Literal["user"]
    content: Union[str, List["InputContent"]]
```

| Property  | Type                               | Description                                                           |
| --------- | ---------------------------------- | --------------------------------------------------------------------- |
| `id`      | `str`                              | Unique identifier for the message                                     |
| `role`    | `Literal["user"]`                  | Role of the message sender, fixed as "user"                           |
| `content` | `Union[str, List["InputContent"]]` | Either a plain text string or an ordered list of multimodal fragments |
| `name`    | `Optional[str]`                    | Optional name of the sender                                           |

### InputContentSource

Represents how a non-text part is supplied.

```python
InputContentSource = Annotated[
    Union[InputContentDataSource, InputContentUrlSource],
    Field(discriminator="type"),
]

class InputContentDataSource(ConfiguredBaseModel):
    type: Literal["data"]
    value: str
    mime_type: str

class InputContentUrlSource(ConfiguredBaseModel):
    type: Literal["url"]
    value: str
    mime_type: Optional[str] = None
```

### TextInputContent

Represents a text fragment inside a multimodal user message.

```python
class TextInputContent(ConfiguredBaseModel):
    type: Literal["text"]
    text: str
```

| Property | Type              | Description                  |
| -------- | ----------------- | ---------------------------- |
| `type`   | `Literal["text"]` | Identifies the fragment type |
| `text`   | `str`             | Text content                 |

### BinaryInputContent

Represents binary data such as images, audio, or files.

```python
class BinaryInputContent(ConfiguredBaseModel):
    type: Literal["binary"]
    mime_type: str
    id: Optional[str] = None
    url: Optional[str] = None
    data: Optional[str] = None
    filename: Optional[str] = None
```

| Property    | Type                | Description                                   |
| ----------- | ------------------- | --------------------------------------------- |
| `type`      | `Literal["binary"]` | Identifies the fragment type                  |
| `mime_type` | `str`               | MIME type, for example `"image/png"`          |
| `id`        | `Optional[str]`     | Reference to previously uploaded content      |
| `url`       | `Optional[str]`     | Remote URL where the content can be retrieved |
| `data`      | `Optional[str]`     | Base64 encoded content                        |
| `filename`  | `Optional[str]`     | Optional filename hint                        |

> **Validation:** At least one of `id`, `url`, or `data` must be provided.
>
> **Deprecated:** `BinaryInputContent` remains available as a temporary
> compatibility model. Prefer modality-specific parts below.

### ImageInputContent / AudioInputContent / VideoInputContent / DocumentInputContent

```python
class ImageInputContent(ConfiguredBaseModel):
    type: Literal["image"]
    source: InputContentSource
    metadata: Optional[Any] = None

class AudioInputContent(ConfiguredBaseModel):
    type: Literal["audio"]
    source: InputContentSource
    metadata: Optional[Any] = None

class VideoInputContent(ConfiguredBaseModel):
    type: Literal["video"]
    source: InputContentSource
    metadata: Optional[Any] = None

class DocumentInputContent(ConfiguredBaseModel):
    type: Literal["document"]
    source: InputContentSource
    metadata: Optional[Any] = None
```

### ToolMessage

`from ag_ui.core import ToolMessage`

Represents a message from a tool.

```python
class ToolMessage(ConfiguredBaseModel):
    id: str
    role: Literal["tool"]
    content: str
    tool_call_id: str
    error: Optional[str] = None
    encrypted_value: Optional[str] = None
```

| Property          | Type              | Description                                     |
| ----------------- | ----------------- | ----------------------------------------------- |
| `id`              | `str`             | Unique identifier for the message               |
| `content`         | `str`             | Text content of the message                     |
| `role`            | `Literal["tool"]` | Role of the message sender, fixed as "tool"     |
| `tool_call_id`    | `str`             | ID of the tool call this message responds to    |
| `error`           | `Optional[str]`   | Error message if the tool call failed           |
| `encrypted_value` | `Optional[str]`   | Optional encrypted value attached via signature |

### ActivityMessage

`from ag_ui.core import ActivityMessage`

Represents structured activity progress emitted between chat messages.

```python
class ActivityMessage(ConfiguredBaseModel):
    id: str
    role: Literal["activity"]
    activity_type: str
    content: Dict[str, Any]
```

| Property        | Type                  | Description                                             |
| --------------- | --------------------- | ------------------------------------------------------- |
| `id`            | `str`                 | Unique identifier for the activity message              |
| `role`          | `Literal["activity"]` | Fixed discriminator identifying the message as activity |
| `activity_type` | `str`                 | Activity discriminator used for renderer selection      |
| `content`       | `Dict[str, Any]`      | Structured payload representing the activity state      |

### ReasoningMessage

`from ag_ui.core import ReasoningMessage`

Represents a reasoning/thinking message from an agent's internal thought
process.

```python
class ReasoningMessage(ConfiguredBaseModel):
    id: str
    role: Literal["reasoning"]
    content: str
    encrypted_value: Optional[str] = None
```

| Property          | Type                   | Description                                        |
| ----------------- | ---------------------- | -------------------------------------------------- |
| `id`              | `str`                  | Unique identifier for the reasoning message        |
| `role`            | `Literal["reasoning"]` | Fixed discriminator identifying the reasoning role |
| `content`         | `str`                  | The reasoning/thinking content                     |
| `encrypted_value` | `Optional[str]`        | Optional encrypted value attached via signature    |

### Message

`from ag_ui.core import Message`

A union type representing any type of message in the system.

```python
Message = Annotated[
    Union[
        DeveloperMessage,
        SystemMessage,
        AssistantMessage,
        UserMessage,
        ToolMessage,
        ActivityMessage,
        ReasoningMessage,
    ],
    Field(discriminator="role")
]
```

### ToolCall

`from ag_ui.core import ToolCall`

Represents a tool call made by an agent.

```python
class ToolCall(ConfiguredBaseModel):
    id: str
    type: Literal["function"]
    function: FunctionCall
    encrypted_value: Optional[str] = None
```

| Property          | Type                  | Description                                     |
| ----------------- | --------------------- | ----------------------------------------------- |
| `id`              | `str`                 | Unique identifier for the tool call             |
| `type`            | `Literal["function"]` | Type of the tool call, always "function"        |
| `function`        | `FunctionCall`        | Details about the function being called         |
| `encrypted_value` | `Optional[str]`       | Optional encrypted value attached via signature |

#### FunctionCall

`from ag_ui.core import FunctionCall`

Represents function name and arguments in a tool call.

```python
class FunctionCall(ConfiguredBaseModel):
    name: str
    arguments: str
```

| Property    | Type  | Description                                      |
| ----------- | ----- | ------------------------------------------------ |
| `name`      | `str` | Name of the function to call                     |
| `arguments` | `str` | JSON-encoded string of arguments to the function |

## Context

`from ag_ui.core import Context`

Represents a piece of contextual information provided to an agent.

```python
class Context(ConfiguredBaseModel):
    description: str
    value: str
```

| Property      | Type  | Description                                 |
| ------------- | ----- | ------------------------------------------- |
| `description` | `str` | Description of what this context represents |
| `value`       | `str` | The actual context value                    |

## Tool

`from ag_ui.core import Tool`

Defines a tool that can be called by an agent.

```python
class Tool(ConfiguredBaseModel):
    name: str
    description: str
    parameters: Any  # JSON Schema
```

| Property      | Type  | Description                                      |
| ------------- | ----- | ------------------------------------------------ |
| `name`        | `str` | Name of the tool                                 |
| `description` | `str` | Description of what the tool does                |
| `parameters`  | `Any` | JSON Schema defining the parameters for the tool |

## State

`from ag_ui.core import State`

Represents the state of an agent during execution.

```python
State = Any
```

The state type is flexible and can hold any data structure needed by the agent
implementation.

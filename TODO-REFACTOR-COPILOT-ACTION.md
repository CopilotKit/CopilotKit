# CopilotKit useCopilotAction Legacy Documentation

This document outlines every instance of `useCopilotAction` found in the docs and example code throughout the CopilotKit codebase, providing context, purpose, and notable parameters for each usage pattern.

## Table of Contents

1. [Basic Frontend Actions](#basic-frontend-actions)
2. [Generative UI Patterns](#generative-ui-patterns)
3. [Human-in-the-Loop Patterns](#human-in-the-loop-patterns)
4. [Remote and Paired Actions](#remote-and-paired-actions)
5. [Catch-All Actions](#catch-all-actions)
6. [Form Filling and Data Input](#form-filling-and-data-input)
7. [CoAgents Integration](#coagents-integration)
8. [Advanced Patterns](#advanced-patterns)

---

## Basic Frontend Actions

### 1. Theme Color Setting (Multiple Examples)

**Files:**

- `examples/coagents-starter/ui/app/page.tsx`
- `registry/registry/quickstarts/no-agent-framework.tsx`
- `registry/public/r/standard-starter.json`
- `registry/public/r/coagents-starter-ui.json`

**Purpose:** Allow AI to dynamically change the application's theme color

```javascript
useCopilotAction({
  name: "setThemeColor",
  parameters: [
    {
      name: "themeColor",
      description: "The theme color to set. Make sure to pick nice colors.",
      required: true,
    },
  ],
  handler({ themeColor }) {
    setThemeColor(themeColor);
  },
});
```

**Context:** Used in starter templates to demonstrate basic frontend action capabilities. Shows how AI can modify UI state through simple parameter passing.

### 2. Adding Proverbs/Content (Multiple Examples)

**Files:**

- `examples/coagents-starter/ui/app/page.tsx`
- `registry/registry/quickstarts/no-agent-framework.tsx`
- `registry/public/r/coagents-starter-ui.json`

**Purpose:** Allow AI to add content to application state

```javascript
useCopilotAction({
  name: "addProverb",
  parameters: [
    {
      name: "proverb",
      description: "The proverb to add. Make it witty, short and concise.",
      required: true,
    },
  ],
  handler: ({ proverb }) => {
    setState({
      ...state,
      proverbs: [...state.proverbs, proverb],
    });
  },
});
```

**Context:** Demonstrates state management integration with AI actions. Common pattern in starter examples.

### 3. Background Color Change (AG2 Examples)

**Files:**

- `examples/ag2/starter/src/app/page.tsx`
- `examples/ag2/feature-viewer/src/files.json`
- `registry/public/r/coagents-starter-crewai-flows.json`

**Purpose:** Dynamic background styling modification

```javascript
useCopilotAction({
  name: "change_background",
  description:
    "Change the background color of the chat. Can be anything that the CSS background attribute accepts.",
  parameters: [{ name: "color", type: "string", required: true }],
  handler: ({ color }) => {
    document.documentElement.style.setProperty(
      "--copilot-kit-background-color",
      color
    );
  },
});
```

**Context:** Used in AG2 integration examples to show real-time UI modifications.

---

## Generative UI Patterns

### 4. Weather Card Generation

**Files:**

- `examples/coagents-starter/ui/app/page.tsx`
- `registry/public/r/coagents-starter-ui.json`

**Purpose:** Generate UI components dynamically
**Special Parameters:** `available: "disabled"`, `render` function

```javascript
useCopilotAction({
  name: "getWeather",
  description: "Get the weather for a given location.",
  available: "disabled",
  parameters: [{ name: "location", type: "string", required: true }],
  render: ({ args }) => {
    return <WeatherCard location={args.location} themeColor={themeColor} />;
  },
});
```

**Context:** Demonstrates generative UI capabilities. The `available: "disabled"` suggests this is used for UI rendering only, not actual data fetching.

### 5. Gradient Card Generation

**Files:**

- `registry/registry/quickstarts/no-agent-framework.tsx`
- `registry/public/r/standard-starter.json`

**Purpose:** Generate visual components with custom styling

```javascript
useCopilotAction({
  name: "generateGradientCard",
  description: "Generate a card with a background gradient between two colors.",
  parameters: [
    { name: "color1", type: "string", required: true },
    { name: "color2", type: "string", required: true },
  ],
  render: ({ args }) => {
    return (
      <div
        style={{
          background: `linear-gradient(to right, ${args.color1}, ${args.color2})`,
        }}
      >
        <p>{args.color1}</p>
        <p>{args.color2}</p>
      </div>
    );
  },
});
```

**Context:** Shows how to create visually dynamic components based on AI-generated parameters.

### 6. Haiku Generation with Approval

**Files:**

- `examples/ag2/feature-viewer/src/app/feature/tool_based_generative_ui/page.tsx`
- `registry/public/r/standard-starter.json`

**Purpose:** Generate content with user approval workflow
**Special Parameters:** `followUp: false`, complex object array parameters

```javascript
useCopilotAction({
  name: "generate_haiku",
  parameters: [
    { name: "japanese", type: "string[]" },
    { name: "english", type: "string[]" },
  ],
  followUp: false,
  handler: async () => {
    return "Haiku generated.";
  },
  render: ({ args: generatedHaiku, result, status }) => {
    return (
      <HaikuApproval
        setHaiku={setHaiku}
        generatedHaiku={generatedHaiku}
        status={status}
      />
    );
  },
});
```

**Context:** Advanced pattern combining content generation with approval UI. `followUp: false` prevents automatic continuation.

---

## Human-in-the-Loop Patterns

### 7. Task Step Selection

**Files:**

- `examples/ag2/feature-viewer/src/app/feature/human_in_the_loop/page.tsx`

**Purpose:** Allow user to approve/modify AI-generated task steps
**Special Parameters:** `renderAndWaitForResponse`, complex object arrays with enums

```javascript
useCopilotAction({
  name: "generate_task_steps",
  parameters: [
    {
      name: "steps",
      type: "object[]",
      attributes: [
        { name: "description", type: "string" },
        {
          name: "status",
          type: "string",
          enum: ["enabled", "disabled", "executing"],
        },
      ],
    },
  ],
  renderAndWaitForResponse: ({ args, respond, status }) => {
    return <StepsFeedback args={args} respond={respond} status={status} />;
  },
});
```

**Context:** Sophisticated human-in-the-loop pattern with enum validation and interactive step management.

### 8. User Input Request

**Files:**

- `examples/langgraph-tutorial-quickstart/ui/src/app/page.tsx`

**Purpose:** Request specific input from user during workflow
**Special Parameters:** `renderAndWait` with handler callback

```javascript
useCopilotAction({
  name: "RequestAssistance",
  parameters: [{ name: "request", type: "string" }],
  renderAndWait: ({ args, status, handler }) => {
    const [response, setResponse] = useState("");
    return (
      <div className="p-4 bg-gray-100 rounded shadow-md">
        <p>{args.request}</p>
        <input
          type="text"
          value={response}
          onChange={(e) => setResponse(e.target.value)}
        />
        {status === "executing" && (
          <button onClick={() => handler(response)}>Submit</button>
        )}
      </div>
    );
  },
});
```

**Context:** Basic human-in-the-loop pattern for gathering user input during agent workflows.

### 9. Trip Management (Travel Example)

**Files:**

- `examples/coagents-travel/ui/lib/hooks/use-trips.tsx`

**Purpose:** Multi-action CRUD operations with human approval
**Special Parameters:** `renderAndWait` with custom component props

```javascript
// Add trips
useCopilotAction({
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

// Update trips
useCopilotAction({
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
  renderAndWait: (props) =>
    EditTrips({
      ...props,
      trips: state.trips,
      selectedTripId: state.selected_trip_id,
    }),
});

// Delete trips
useCopilotAction({
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
```

**Context:** Complex CRUD operations with shared state management and contextual data passing to render components.

---

## Remote and Paired Actions

### 10. Email Tool Chain

**Files:**

- `examples/coagents-qa-native/ui/app/Mailer.tsx`

**Purpose:** Chain of actions for email processing with remote execution
**Special Parameters:** `available: "remote"`, `pairedAction`

```javascript
// Remote email tool
useCopilotAction({
  name: "EmailTool",
  available: "remote",
  parameters: [{ name: "the_email" }],
  handler: async ({ the_email }) => {
    return { emailContent: the_email };
  },
});

// Paired display action
useCopilotAction({
  name: "DisplayEmail",
  pairedAction: "EmailTool",
  parameters: [{ name: "emailContent" }],
  handler: async ({ emailContent }) => {
    const result = window.confirm(emailContent);
    const action = result ? "SEND" : "CANCEL";
    setMessageState(action);
    return action;
  },
});
```

**Context:** Demonstrates action chaining where one action feeds into another. `available: "remote"` indicates backend execution.

---

## Catch-All Actions

### 11. Generic Tool Rendering

**Files:**

- `registry/registry/quickstarts/coagents-generic-lg/page.tsx`
- `registry/registry/quickstarts/mcp-starter/page.tsx`
- `registry/public/r/generic-lg-starter.json`
- `registry/public/r/mcp-starter.json`

**Purpose:** Handle any/all tool calls with generic rendering
**Special Parameters:** `name: "*"`, `CatchAllActionRenderProps`

```javascript
useCopilotAction({
  name: "*",
  render: ({ name, args, status, result }: CatchAllActionRenderProps) => {
    return <ToolCall name={name} args={args} status={status} result={result} />;
  },
});
```

**Context:** Provides fallback rendering for any tool call. Useful for generic agent integrations where tool calls are unknown at compile time.

---

## Form Filling and Data Input

### 12. Incident Report Form

**Files:**

- `examples/copilot-form-filling/components/IncidentReportForm.tsx`

**Purpose:** AI-powered form filling with complex validation
**Special Parameters:** Extensive parameter definitions with detailed descriptions

```javascript
useCopilotAction({
  name: "fillIncidentReportForm",
  description: "Fill out the incident report form",
  parameters: [
    {
      name: "fullName",
      type: "string",
      required: true,
      description: "The full name of the person reporting the incident",
    },
    {
      name: "incidentType",
      type: "string",
      required: true,
      description:
        "The type of incident, must be one of: phishing, malware, data_breach, unauthorized_access, ddos, other",
    },
    {
      name: "incidentLevel",
      type: "string",
      required: true,
      description:
        "The severity of the incident, must be one of: low, medium, high, critical",
    },
    // ... many more detailed parameters
  ],
  handler: async (action) => {
    form.setValue("name", action.fullName);
    form.setValue("email", action.email);
    form.setValue("description", action.incidentDescription);
    form.setValue("date", new Date(action.date));
    form.setValue("impactLevel", action.incidentLevel);
    form.setValue("incidentType", action.incidentType);
    form.setValue("suggestedActions", action.suggestedActions);
  },
});
```

**Context:** Comprehensive form automation with detailed parameter validation and React Hook Form integration.

### 13. Input Collection for Crew Operations

**Files:**

- `examples/coagents-enterprise-crewai-crews/ui/src/hooks/useInput.tsx`
- `registry/public/r/coagents-crew-starter.json`
- `registry/public/r/crew-quickstart.json`

**Purpose:** Collect required inputs before starting crew execution
**Special Parameters:** `renderAndWaitForResponse`, `followUp: false`

```javascript
useCopilotAction({
  name: "getInputs",
  followUp: false,
  description:
    "This action allows Crew to get required inputs from the user before starting the Crew.",
  renderAndWaitForResponse(props) {
    const { status, args, respond } = props;
    return <InputComponent status={status} respond={respond} />;
  },
});
```

**Context:** Pre-execution input gathering for crew-based workflows. `followUp: false` prevents automatic continuation.

---

## CoAgents Integration

### 14. Crew Feedback Handling

**Files:**

- `examples/coagents-enterprise-crewai-crews/ui/src/app/page.tsx`
- `registry/public/r/coagents-crew-starter.json`
- `registry/public/r/crew-quickstart.json`

**Purpose:** Handle feedback requests from CrewAI agents
**Special Parameters:** `renderAndWaitForResponse` with complex feedback objects

```javascript
useCopilotAction({
  name: "crew_requesting_feedback",
  description: "Request feedback from the user",
  renderAndWaitForResponse(props) {
    const { status, args, respond } = props;
    const feedback = args as CrewFeedback;
    return (
      <DefaultResponseRenderer
        response={{
          id: feedback.id || String(Date.now()),
          content: feedback.task_output || String(feedback),
        }}
        onRespond={(input: string) => {
          respond?.(input);
        }}
        status={status}
        ContentRenderer={({ content }) => (
          <ReactMarkdown>{content}</ReactMarkdown>
        )}
      />
    );
  },
});
```

**Context:** Advanced crew integration with markdown rendering and structured feedback handling.

### 15. Research Canvas Integration

**Files:**

- `examples/coagents-research-canvas/ui/src/components/ResearchCanvas.tsx`

**Purpose:** Integration with research workflow canvas
**Special Parameters:** Complex object handling for research operations

```javascript
useCopilotAction({
  name: "research_action",
  description: "Handle research operations on the canvas",
  parameters: [
    {
      name: "operation",
      type: "object",
      // Complex research operation parameters
    },
  ],
  handler: async ({ operation }) => {
    // Handle research canvas operations
  },
});
```

**Context:** Specialized for research workflow management with canvas-based interactions.

---

## Advanced Patterns

### 16. Knowledge Base Search

**Files:**

- `examples/copilot-anthropic-pinecone/src/app/ui/components/KnowledgeBase.tsx`

**Purpose:** Vector database search integration
**Special Parameters:** Simple render string for loading state

```javascript
useCopilotAction({
  name: "FetchKnowledgebaseArticles",
  description: "Fetch relevant knowledge base articles based on a user query",
  parameters: [
    {
      name: "query",
      type: "string",
      description: "User query for the knowledge base",
      required: true,
    },
  ],
  render: "Getting relevant answers to your query...",
});
```

**Context:** Integration with vector databases (Pinecone) for semantic search. Simple string render for loading feedback.

### 17. Predictive State Updates

**Files:**

- `examples/ag2/feature-viewer/src/app/feature/predictive_state_updates/page.tsx`

**Purpose:** Confirm changes before applying them to state
**Special Parameters:** `renderAndWaitForResponse` for change confirmation

```javascript
useCopilotAction({
  name: "confirm_changes",
  renderAndWaitForResponse: ({ args, respond, status }) => (
    <ConfirmChanges args={args} respond={respond} status={status} />
  ),
});
```

**Context:** Predictive text editing with user confirmation before applying changes.

---

## Summary

The `useCopilotAction` hook demonstrates remarkable flexibility across different integration patterns:

- **Basic Actions**: Simple state modifications with handler functions
- **Generative UI**: Dynamic component rendering based on AI parameters
- **Human-in-the-Loop**: Interactive workflows requiring user input/approval
- **Remote Actions**: Backend-executed operations with frontend feedback
- **Catch-All Actions**: Generic handling of unknown tool calls
- **Form Integration**: Complex form automation with validation
- **CoAgent Integration**: Sophisticated multi-agent workflow management

### Key Parameters:

- `available`: Controls execution location ("remote", "disabled")
- `pairedAction`: Links actions in chains
- `followUp`: Controls automatic workflow continuation
- `renderAndWaitForResponse`: Interactive user input collection
- `renderAndWait`: Simplified interaction patterns
- `render`: UI generation and feedback display
- `name: "*"`: Catch-all pattern for unknown actions

This comprehensive usage demonstrates CopilotKit's versatility in bridging AI capabilities with frontend applications across various complexity levels and integration patterns.

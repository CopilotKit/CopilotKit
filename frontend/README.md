# Vue.js CopilotKit Implementation - Alpha Guide

## Project Setup

This guide outlines the steps to set up and run the backend and frontend components of this Vue.js CopilotKit implementation.

### 1. Backend Setup

The backend server is located in the `backend` directory.

**Prerequisites:**
*   Python 3.7+
*   `pip` (Python package installer)

**Steps:**

1.  **Navigate to the backend directory:**
    ```bash
    cd backend
    ```

2.  **Create and activate a Python virtual environment (recommended):**
    ```bash
    # For Unix or macOS
    python3 -m venv venv
    source venv/bin/activate

    # For Windows
    python -m venv venv
    .\venv\Scripts\activate
    ```

3.  **Install Python dependencies:**
    The required packages are listed in `requirements.txt`.
    ```bash
    pip install -r requirements.txt
    ```
    *(The `requirements.txt` file was created with `Flask`, `python-dotenv`, `openai`, `copilot-kit`, and `langchain`.)*

4.  **Set up environment variables:**
    The backend requires an `OPENAI_API_KEY`. Create a `.env` file in the `backend` directory:
    ```
    backend/.env
    ```
    Add your OpenAI API key to this file:
    ```env
    OPENAI_API_KEY="your_openai_api_key_here"
    ```
    The Flask application (`app.py`) uses `python-dotenv` to load this key.

5.  **Run the Flask server:**
    ```bash
    python app.py
    ```
    Alternatively, if your `app.py` is set up for it (e.g., `FLASK_APP=app.py`), you might use:
    ```bash
    flask run
    ```
    The server will typically start on `http://127.0.0.1:5000`. The backend API endpoint for CopilotKit is `/api/copilotkit`.

### 2. Frontend Setup

The frontend Vue.js application is located in the `frontend` directory.

**Prerequisites:**
*   Node.js (which includes npm) - Version 16.x or higher recommended.

**Steps:**

1.  **Navigate to the frontend directory:**
    ```bash
    cd frontend
    ```

2.  **Install Node.js dependencies:**
    ```bash
    npm install
    ```

3.  **Run the Vite development server:**
    ```bash
    npm run dev
    ```
    This will typically start the frontend application on `http://localhost:5173` (the port might vary if 5173 is in use). The application will connect to the backend API specified in its requests (usually `/api/copilotkit`, which Vite will proxy if configured, or assumes the backend is on the same host/port if not proxied for dev).

---

Once both backend and frontend servers are running, you should be able to access the Vue.js application in your browser and interact with the CopilotKit features.

## Overall Architecture

This project demonstrates a foundational structure for integrating AI copilot capabilities into a Vue.js application. The frontend UI components (`CopilotPopup.vue` for chat, `CopilotTextarea.vue` for text assistance) provide user interaction points. The Vue composables (`useCopilotAction`, `useCopilotReadable`, `useCopilotTask`) are key to defining the AI's understanding of the application: `useCopilotReadable` makes application data available to the AI, while `useCopilotAction` and `useCopilotTask` define functions and autonomous tasks the AI can theoretically invoke.

The Python Flask server (`backend/app.py`) acts as the server-side AI orchestrator. It's responsible for handling requests from the frontend (e.g., chat messages), interacting with an AI model (like OpenAI's GPT via LangChain), and potentially mediating access to client-side capabilities defined by the composables.

In this alpha version, the direct, dynamic integration between the frontend composables (for registering actions, tasks, and readable context with the backend) and the backend's orchestration layer is primarily mocked on the client side (e.g., actions are stored in a local array). The structure is in place for future development where a more complete CopilotKit Vue SDK would facilitate this communication, allowing the AI backend to discover and utilize the frontend-defined capabilities seamlessly. The current focus is on establishing the patterns and components for such an integration.

## How to Run the Demo

Before proceeding, ensure you have completed the "Project Setup" steps, especially installing dependencies for both frontend and backend, and setting the `OPENAI_API_KEY` in the `backend/.env` file.

### Step 1: Start the Backend Server

1.  **Navigate to the backend directory:**
    Open a terminal and change to the `backend` directory.
    ```bash
    cd path/to/your/project/backend 
    ```
    (Replace `path/to/your/project/` with the actual path to the project root.)

2.  **Activate your Python virtual environment (if you created one):**
    ```bash
    # For Unix or macOS
    source venv/bin/activate

    # For Windows
    .\venv\Scripts\activate
    ```

3.  **Run the Flask application:**
    ```bash
    python app.py
    ```
    Or, if you have `FLASK_APP` configured:
    ```bash
    flask run
    ```

4.  **Expected Output:**
    You should see output indicating the Flask development server is running, typically on `http://127.0.0.1:5000/`.
    ```
     * Serving Flask app 'app'
     * Debug mode: on
     * Running on http://127.0.0.1:5000 (Press CTRL+C to quit)
    ```
    Keep this terminal window open.

### Step 2: Start the Frontend Dev Server

1.  **Navigate to the frontend directory:**
    Open a **new** terminal window or tab and change to the `frontend` directory.
    ```bash
    cd path/to/your/project/frontend
    ```
    (Replace `path/to/your/project/` with the actual path to the project root.)

2.  **Run the Vite development server:**
    ```bash
    npm run dev
    ```

3.  **Expected Output:**
    You should see output indicating the Vite server is running, typically on `http://localhost:5173/`.
    ```
      VITE vX.Y.Z  ready in XXX ms

      ➜  Local:   http://localhost:5173/
      ➜  Network: use --host to expose
      ➜  press h + enter to show help
    ```
    Keep this terminal window open as well.

### Step 3: View the Demo

1.  **Open your browser:**
    Navigate to the local URL provided by the Vite server (usually `http://localhost:5173/`).

2.  **What to Expect:**
    *   The `App.vue` component will be rendered, serving as the main demonstration page.
    *   You will see sections for:
        *   **Copilot Popup:** A chat icon fixed at the bottom right. Clicking it will open the chat interface. You can send messages and receive (currently LangChain-powered placeholder) responses from the backend.
        *   **Copilot Textarea:** A textarea component with placeholder AI action buttons.
        *   **useCopilotAction Registrations:** A list of actions registered for AI use (check browser console for details).
        *   **useCopilotReadable Contexts:** A display of various application contexts made available to the AI (check browser console for details and updates when you interact with the buttons in this section).
        *   **useCopilotTask Registrations:** A list of tasks registered for AI use (check browser console for details).
    *   **Browser Console:** Open your browser's developer console (usually by pressing F12). You will see logs from the CopilotKit components and composables as they register actions, provide context, and handle tasks (in their mocked alpha state). This is where you can observe the "behind-the-scenes" activity of the composables.

You can now interact with the demo page, try the chat, and observe the console logs to understand how the different parts of this Vue.js CopilotKit implementation are working.

## Components

This section describes the reusable Vue components provided in this project.

### `CopilotPopup.vue`

**Location:** `src/components/CopilotPopup.vue`

The `CopilotPopup` component provides a floating AI chat popup interface. It allows users to interact with the AI backend, send messages, and view responses in a familiar chat format.

**Features:**
*   A toggle button fixed to the bottom-right of the screen to open/close the chat window.
*   A chat window for displaying conversation history.
*   An input field for users to type and send messages.
*   Basic loading and error states when interacting with the backend.

**Usage:**

To use `CopilotPopup` in your Vue application, import it and include it in your component's template. It's designed to be largely self-contained for its core functionality.

```vue
<script setup>
import CopilotPopup from './components/CopilotPopup.vue'; // Adjust path as needed
</script>

<template>
  <div>
    <!-- Your other application content -->
    <CopilotPopup />
  </div>
</template>
```

**Backend Connection:**
The component is pre-configured to make requests to the `/api/copilotkit` endpoint, which is handled by the Flask backend server (`backend/app.py`) of this project. Ensure the backend server is running for the chat functionality to work.

**Props:**
Currently, `CopilotPopup.vue` does not require any specific props for its basic operation. It is self-contained and manages its own state. Future enhancements might introduce props for customization.

### `CopilotTextarea.vue`

**Location:** `src/components/CopilotTextarea.vue`

The `CopilotTextarea` component is an AI-powered textarea intended to provide features like autocompletion and AI-driven text editing. It includes a standard textarea input along with buttons for AI-related actions.

**Usage:**

Import the component and include it in your template. You can use its props to set an initial value and placeholder text.

```vue
<script setup>
import CopilotTextarea from './components/CopilotTextarea.vue'; // Adjust path as needed
import { ref } from 'vue';

const myText = ref("This is some initial content for the textarea.");
</script>

<template>
  <div>
    <CopilotTextarea 
      :initialValue="myText.value" 
      placeholder="Type your content here and use AI features..."
    />
    <!-- To bind with v-model (if component is adapted for it): -->
    <!-- <CopilotTextarea v-model="myText" ... /> -->
  </div>
</template>
```

**Props:**

*   `initialValue`:
    *   **Type:** `String`
    *   **Default:** `''` (empty string)
    *   **Description:** Sets the initial text content of the textarea when the component is mounted.
*   `placeholder`:
    *   **Type:** `String`
    *   **Default:** `'Enter text here...'`
    *   **Description:** Specifies the placeholder text for the textarea, visible when the textarea is empty.

**Current AI Functionality:**

*   **UI Placeholders:** The "Trigger Autocomplete" and "AI Edit" buttons are currently UI placeholders.
*   **Not Implemented:** The actual AI-driven autocompletion and text editing functionalities associated with these buttons are **not yet implemented** in this alpha version. Clicking these buttons will log a message to the console indicating they were triggered. Future development will focus on integrating these AI features.

## Composables

This section describes the reusable Vue composables provided in this project, designed to mimic parts of the CopilotKit SDK functionality for Vue.

### `useCopilotAction`

**Location:** `src/composables/useCopilotAction.js`

The `useCopilotAction` composable allows you to define client-side actions that can theoretically be invoked by the AI. These actions consist of a name, description, parameters, and a handler function that executes the action's logic.

**Usage Example:**

This composable is typically called within the `<script setup>` block of a Vue component.

```vue
<script setup>
import { useCopilotAction } from './composables/useCopilotAction.js'; // Adjust path as needed

useCopilotAction({
  name: "notifyUser",
  description: "Sends a notification message to the user.",
  parameters: [
    { 
      name: "message", 
      type: "string", 
      description: "The content of the notification.",
      required: true 
    },
    {
      name: "type",
      type: "string",
      description: "The type of notification (e.g., 'info', 'warning', 'error').",
      enum: ["info", "warning", "error"],
      required: false
    }
  ],
  handler: async (args) => {
    // In a real app, this might show a toast notification or alert.
    const notificationType = args.type || 'info';
    const fullMessage = `Notification (${notificationType}): ${args.message}`;
    console.log(fullMessage); 
    // You might return a status or result to the AI.
    return `Notification shown: ${args.message}`; 
  },
});
</script>
```

**`actionConfig` Object:**

The `useCopilotAction` composable accepts a single configuration object (`actionConfig`) with the following properties:

*   `name` (String, required):
    *   A unique identifier for the action. This name is used by the AI to specify which action to call.
*   `description` (String, required):
    *   A human-readable description of what the action does. This helps the AI understand the action's purpose.
*   `parameters` (Array<Object>, optional):
    *   An array defining the parameters that the action's `handler` function expects. Each parameter object in the array should have the following structure:
        *   `name` (String, required): The name of the parameter.
        *   `type` (String, required): The data type of the parameter (e.g., "string", "number", "boolean").
        *   `description` (String, required): A description of the parameter for the AI.
        *   `enum` (Array<String>, optional): An array of possible values for the parameter.
        *   `required` (Boolean, optional): Specifies if the parameter is required. Defaults to `false` if not provided.
*   `handler` (Function, required):
    *   An asynchronous function (`async (args) => { ... }`) that is executed when the AI calls this action.
    *   It receives a single object `args` where keys are parameter names and values are the arguments provided by the AI.
    *   The handler should perform the action's logic and can return a result (e.g., a string or object) that the AI can use.

**Current Implementation Status (Alpha):**

*   **Mocked Registration:** In this alpha version, actions defined using `useCopilotAction` are registered in a mock store (`registeredActions` array within the composable's module).
*   **Console Logging:** The registration of an action is logged to the console.
*   **Not Live:** These actions are **not yet callable by a live AI backend**. The infrastructure for the AI to discover and invoke these client-side Vue actions is a future development area. The current implementation focuses on defining the structure and local registration mechanism. Helper functions like `getRegisteredActions()` and `clearRegisteredActions()` are available for debugging the local mock store.

### `useCopilotReadable`

**Location:** `src/composables/useCopilotReadable.js`

The `useCopilotReadable` composable allows you to make application context (data) available to the AI. This context can be static or reactive. If reactive, the AI would theoretically have access to its real-time value.

**Usage Examples:**

This composable is called within the `<script setup>` block of a Vue component.

```vue
<script setup>
import { useCopilotReadable } from './composables/useCopilotReadable.js'; // Adjust path as needed
import { ref, computed } from 'vue';

// 1. Providing context from a static string
useCopilotReadable("The current application version is 1.0-alpha.", "appVersionContext");

// 2. Providing context from a Vue ref
const userName = ref("DemoUser");
useCopilotReadable(userName, "currentUserContext");

// To demonstrate reactivity, you can change userName elsewhere:
// setTimeout(() => { userName.value = "UpdatedUser"; }, 5000);

// 3. Providing context from a Vue computed property
const userRole = ref("Admin");
const userPermissions = computed(() => {
  return userRole.value === "Admin" ? ["create", "read", "update", "delete"] : ["read"];
});
useCopilotReadable(userPermissions, "userPermissionsContext");

// 4. Providing context from a function
// The function will be wrapped in a computed property by the composable
// to track its reactive dependencies.
const systemStatus = ref("OK");
function getFullSystemStatus() {
  return `System is currently: ${systemStatus.value}. Last checked: ${new Date().toLocaleTimeString()}`;
}
useCopilotReadable(getFullSystemStatus, "systemStatusFunctionContext");
</script>
```

**Parameters:**

*   `contextSource` (String | Ref | Computed | Function, required):
    *   The source of the data to be made readable by the AI. It can be:
        *   A static JavaScript string.
        *   A Vue `ref` object.
        *   A Vue `computed` property.
        *   A function that returns a string (or any serializable data). If the function relies on Vue's reactive sources (like `ref`s or `computed`s), `useCopilotReadable` will wrap it in a `computed` to ensure reactivity.
*   `parentContextId` (String, optional):
    *   An optional ID of a parent context. This is intended for creating hierarchical or grouped contexts, though this feature is not fully utilized in the current alpha's backend interaction.

**Reactivity and Lifecycle Management:**

*   **Reactivity:** When you provide a Vue `ref`, `computed` property, or a function that depends on reactive sources, `useCopilotReadable` automatically watches for changes. If the underlying data changes, the context provided to the (conceptual) AI is updated in real-time.
*   **Lifecycle:** The composable is lifecycle-aware. When the component instance that called `useCopilotReadable` is unmounted, the provided context is automatically cleaned up and removed from the active context list. This prevents memory leaks and ensures that the AI doesn't try to access stale data.

**Current Implementation Status (Alpha):**

*   **Mocked Provisioning:** In this alpha version, context provided via `useCopilotReadable` is added to a local mock store (`providedContexts` array within the composable's module).
*   **Console Logging:** The provisioning of context and any subsequent updates (due to reactivity) are logged to the console. When a component unmounts, the removal of its provided context is also logged.
*   **Not Live:** This context is **not yet actually sent to or accessible by a live AI backend**. The infrastructure for the AI to query or subscribe to this context is a future development area. Helper functions like `getProvidedContexts()` and `clearProvidedContexts()` are available for debugging the local mock store.

### `useCopilotTask`

**Location:** `src/composables/useCopilotTask.js`

The `useCopilotTask` composable is designed for defining complex, multi-step autonomous tasks that the AI can initiate and manage. These tasks are typically long-running and might involve several interactions or steps.

**Usage Example:**

This composable is called within the `<script setup>` block of a Vue component.

```vue
<script setup>
import { useCopilotTask } from './composables/useCopilotTask.js'; // Adjust path as needed
import { ref } from 'vue';

const taskStatus = ref("idle");

useCopilotTask({
  name: "generateReport",
  description: "Generates a complex report based on several data sources and user preferences.",
  initialState: { progress: 0, currentStep: "Starting" },
  handler: async (taskArgs) => {
    console.log(`[Task: generateReport] Started with args:`, taskArgs);
    taskStatus.value = "Fetching data...";
    // Simulate step 1: Fetch data
    await new Promise(resolve => setTimeout(resolve, 1000)); 
    console.log("[Task: generateReport] Step 1: Data fetched.");
    
    taskStatus.value = "Processing data...";
    // Simulate step 2: Process data
    await new Promise(resolve => setTimeout(resolve, 1500));
    console.log("[Task: generateReport] Step 2: Data processed.");

    taskStatus.value = "Finalizing report...";
    // Simulate step 3: Finalize report
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log("[Task: generateReport] Step 3: Report finalized.");
    
    taskStatus.value = "Completed";
    return "Report generation complete. The report is now available at /reports/generated_report.pdf";
  },
});
</script>

<template>
  <div>
    <p>Report Generation Status: {{ taskStatus }}</p>
  </div>
</template>
```

**`taskConfig` Object:**

The `useCopilotTask` composable accepts a single configuration object (`taskConfig`) with the following properties:

*   `name` (String, required):
    *   A unique identifier for the task.
*   `description` (String, required):
    *   A human-readable description of what the task does and what its outcome will be.
*   `initialState` (Any, optional):
    *   An optional initial state for the task. This can be any data type (e.g., object, string, number) that represents the starting state of the task. The task's `handler` function would be responsible for managing and updating this state as it progresses.
*   `handler` (Function, required):
    *   An asynchronous function (`async (args) => { ... }`) that contains the logic for executing the task.
    *   It can receive arguments (`args`) from the AI if the task definition includes parameters (though parameter definition for tasks is not explicitly shown in this alpha example, it's a common pattern).
    *   The handler should manage the task's execution, potentially updating its state over time, and can return a final result or status.

**Current Implementation Status (Alpha):**

*   **Mocked Registration:** Tasks defined using `useCopilotTask` are registered in a local mock store (`registeredTasks` array within the composable's module).
*   **Console Logging:** The registration of a task is logged to the console.
*   **Not Live:** These tasks are **not yet executable or manageable by a live AI backend**. The infrastructure for the AI to initiate, monitor progress, and receive results from these client-side Vue tasks is a future development area. The current implementation focuses on the structural definition of such tasks. Helper functions like `getRegisteredTasks()` and `clearRegisteredTasks()` are available for debugging the local mock store.

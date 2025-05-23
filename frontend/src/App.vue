<script setup>
import { ref, computed, onMounted } from 'vue';
import CopilotPopup from './components/CopilotPopup.vue';
import CopilotTextarea from './components/CopilotTextarea.vue';
import { useCopilotAction, getRegisteredActions } from './composables/useCopilotAction.js';
import { useCopilotReadable, getProvidedContexts } from './composables/useCopilotReadable.js';
import { useCopilotTask, getRegisteredTasks } from './composables/useCopilotTask.js';

// --- CopilotTextarea Demo ---
const textAreaInitialContent = ref("This is some initial content for the textarea. Try editing it!");

// --- useCopilotAction Demo ---
useCopilotAction({
  name: "getCurrentTime",
  description: "Gets the current time.",
  handler: async () => {
    const time = new Date().toLocaleTimeString();
    console.log("[Action] getCurrentTime executed. Current time:", time);
    return `The current time is ${time}.`;
  },
});

useCopilotAction({
  name: "greetUser",
  description: "Greets a user with a custom message.",
  parameters: [
    { name: "userName", type: "string", description: "The name of the user to greet.", required: true },
    { name: "greeting", type: "string", description: "The greeting message to use.", enum: ["Hello", "Hi", "Greetings"] },
  ],
  handler: async (args) => {
    const message = `${args.greeting || 'Hello'}, ${args.userName}!`;
    console.log("[Action] greetUser executed. Message:", message, "Args:", args);
    return message;
  },
});

// --- useCopilotReadable Demo ---
const appVersion = '1.0.1-demo';
const currentUser = ref({ name: 'Demo User', role: 'Admin', id: 'user123' });
const dynamicCounter = ref(0);
const specialMessage = ref("Initial special message.");

// Providing static string context
useCopilotReadable(appVersion, 'appInfo');
// Providing a ref as context
useCopilotReadable(currentUser, 'userInfo');
// Providing a computed property as context
const counterMessage = computed(() => `The current counter value is ${dynamicCounter.value}.`);
useCopilotReadable(counterMessage, 'counterInfo');

// Providing a function as context (will be wrapped in computed by useCopilotReadable)
function getSpecialMessage() {
  return `Special Info: ${specialMessage.value} (Counter: ${dynamicCounter.value})`;
}
useCopilotReadable(getSpecialMessage, 'specialInfo');


const updateDynamicCounter = () => {
  dynamicCounter.value++;
  console.log("Dynamic counter updated to:", dynamicCounter.value);
};

const updateCurrentUser = () => {
  currentUser.value.name = "Updated Demo User";
  currentUser.value.role = currentUser.value.role === 'Admin' ? 'Editor' : 'Admin';
  console.log("Current user updated:", currentUser.value);
};

const updateSpecialMessage = () => {
  specialMessage.value = `New special message at ${new Date().toLocaleTimeString()}`;
}

// --- useCopilotTask Demo ---
useCopilotTask({
  name: "summarizeDocumentTask",
  description: "Simulates fetching and summarizing a document.",
  initialState: { progress: 0, status: "idle" },
  handler: async (taskArgs) => {
    console.log("[Task] summarizeDocumentTask started. Args:", taskArgs);
    // Simulate task steps
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate fetching
    console.log("[Task] summarizeDocumentTask: Document fetched.");
    // Here, you would manage the task's state, e.g., update progress
    await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate summarization
    console.log("[Task] summarizeDocumentTask: Document summarized.");
    return "Document summarization complete. Summary: [Simulated Summary]";
  },
});

onMounted(() => {
  console.log("App.vue mounted. Demonstrating CopilotKit features.");
  console.log("Registered Actions:", getRegisteredActions());
  console.log("Provided Contexts:", getProvidedContexts());
  console.log("Registered Tasks:", getRegisteredTasks());
});

</script>

<template>
  <div id="app-container">
    <header>
      <h1>Vue 3 CopilotKit Demo</h1>
    </header>

    <section id="copilot-popup-demo">
      <h2>Copilot Popup</h2>
      <CopilotPopup />
      <p><em>(Chat button is fixed at the bottom right. The backend needs to be running for full functionality.)</em></p>
    </section>

    <hr />

    <section id="copilot-textarea-demo">
      <h2>Copilot Textarea</h2>
      <CopilotTextarea
        :initialValue="textAreaInitialContent.value"
        placeholder="Try AI features here... (Note: AI features are placeholders)"
      />
    </section>

    <hr />

    <section id="use-copilot-action-demo">
      <h2>useCopilotAction Registrations</h2>
      <p>The following actions have been registered (check console logs for details):</p>
      <ul>
        <li><code>getCurrentTime</code> (no parameters)</li>
        <li><code>greetUser</code> (parameters: <code>userName</code>, <code>greeting</code>)</li>
      </ul>
      <p><em>(These actions would be invokable by the AI via the Copilot backend.)</em></p>
    </section>

    <hr />

    <section id="use-copilot-readable-demo">
      <h2>useCopilotReadable Contexts</h2>
      <p>The following contexts are provided to the AI (check console logs for details and updates):</p>
      <ul>
        <li>App Version (Static String): {{ appVersion }}</li>
        <li>Current User (Reactive Ref): {{ currentUser }}</li>
        <li>Counter Message (Reactive Computed): {{ counterMessage }}</li>
        <li>Special Message (Reactive Function): {{ getSpecialMessage() }}</li>
      </ul>
      <button @click="updateDynamicCounter">Increment Counter (updates CounterMessage & SpecialMessage)</button>
      <button @click="updateCurrentUser" style="margin-left: 10px;">Update User Info</button>
      <button @click="updateSpecialMessage" style="margin-left: 10px;">Update Special Message Directly</button>
    </section>

    <hr />

    <section id="use-copilot-task-demo">
      <h2>useCopilotTask Registrations</h2>
      <p>The following task has been registered (check console logs for details):</p>
      <ul>
        <li><code>summarizeDocumentTask</code></li>
      </ul>
      <p><em>(This task would be invokable by the AI to perform autonomous operations.)</em></p>
    </section>

    <hr />
    <footer>
      <p>Open the browser console to see logs from CopilotKit components and composables.</p>
       <div>
        <a href="https://vite.dev" target="_blank">
          <img src="/vite.svg" class="logo" alt="Vite logo" />
        </a>
        <a href="https://vuejs.org/" target="_blank">
          <img src="./assets/vue.svg" class="logo vue" alt="Vue logo" />
        </a>
      </div>
    </footer>
  </div>
</template>

<style> /* Changed from scoped to allow some global styling */
/* Global Styles */
body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #333; /* Darker text for better readability */
  background-color: #f4f7f9; /* Light background for the page */
  margin: 0;
  padding: 0;
}

#app-container {
  margin: 0 auto;
  padding: 20px;
  max-width: 960px; /* Slightly wider for better layout */
}

header {
  text-align: center;
  margin-bottom: 40px; /* Increased margin */
}

header h1 {
  color: #2c3e50; /* Theme color from original */
  font-size: 2.2rem;
}

hr {
  margin: 40px 0; /* Increased margin */
  border: 0;
  border-top: 1px solid #dfe6ec; /* Softer hr color */
}

section {
  margin-bottom: 35px; /* Consistent margin */
  padding: 20px; /* Increased padding */
  border: 1px solid #dfe6ec; /* Softer border */
  border-radius: 8px;
  background-color: #ffffff; /* White background for sections */
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05); /* Subtle shadow for depth */
}

h2 {
  margin-top: 0;
  color: #2c3e50; /* Theme color */
  border-bottom: 2px solid #5dade2; /* Theme accent color */
  padding-bottom: 10px; /* Increased padding */
  margin-bottom: 20px; /* Increased margin */
  font-size: 1.6rem;
}

/* General button styling - can be overridden by more specific component styles */
button, .button { /* Added .button class for flexibility */
  background-color: #5dade2; /* Theme accent color */
  color: white;
  border: none;
  padding: 10px 18px; /* Increased padding */
  border-radius: 5px; /* Slightly more rounded */
  cursor: pointer;
  font-size: 0.95rem; /* Slightly larger font */
  transition: background-color 0.2s ease-in-out, box-shadow 0.2s ease;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

button:hover, .button:hover {
  background-color: #4ca9d4; /* Darker shade on hover */
  box-shadow: 0 2px 5px rgba(0,0,0,0.15);
}

button:disabled, .button:disabled {
  background-color: #a9cce3; /* Lighter, desaturated color for disabled */
  color: #eaf2f8;
  cursor: not-allowed;
  box-shadow: none;
}

/* Specifically target buttons within sections for margin if needed */
section button {
  margin-right: 8px; /* Add some space between buttons */
  margin-bottom: 8px; /* Add space if they wrap */
}


ul {
  list-style-type: disc;
  padding-left: 25px; /* Slightly more padding */
  line-height: 1.6;
}

li {
  margin-bottom: 8px; /* Increased spacing */
}

code {
  background-color: #e8f0f3; /* Lighter, less prominent background */
  padding: 3px 6px; /* Adjusted padding */
  border-radius: 4px;
  font-family: 'Consolas', 'Courier New', Courier, monospace;
  color: #2c3e50; /* Match text color */
  font-size: 0.9em;
}

.logo {
  height: 3.5em; /* Adjusted size */
  padding: 0.8em;
  will-change: filter;
  transition: filter 300ms;
}
.logo:hover {
  filter: drop-shadow(0 0 1.2em #5dade2aa); /* Theme color shadow */
}
.logo.vue:hover {
  filter: drop-shadow(0 0 1.2em #42b883aa);
}

footer {
  text-align: center;
  margin-top: 50px; /* Increased margin */
  padding-top: 20px;
  border-top: 1px solid #dfe6ec;
  font-size: 0.9em;
  color: #566573; /* Slightly darker footer text */
}

/* Demo specific improvements */
#copilot-popup-demo p em {
  color: #566573;
  font-size: 0.9rem;
}

#use-copilot-readable-demo ul,
#use-copilot-action-demo ul,
#use-copilot-task-demo ul {
  background-color: #f8f9f9;
  padding: 15px;
  border-radius: 5px;
  border: 1px solid #e8f0f3;
}

/* Basic responsiveness */
@media (max-width: 768px) {
  #app-container {
    padding: 15px;
  }
  header h1 {
    font-size: 1.8rem;
  }
  h2 {
    font-size: 1.4rem;
  }
  button, .button {
    padding: 8px 15px;
    font-size: 0.9rem;
  }
  .logo {
    height: 3em;
  }
}

@media (max-width: 480px) {
  header h1 {
    font-size: 1.6rem;
  }
  h2 {
    font-size: 1.3rem;
  }
  section {
    padding: 15px;
  }
}

</style>

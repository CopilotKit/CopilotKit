// Mock store for registered tasks
export const registeredTasks = [];

/**
 * Composable to define and register a Copilot task.
 * This is a Vue equivalent to the React CopilotTask concept.
 *
 * @param {object} taskConfig - Configuration for the task.
 * @param {string} taskConfig.name - The unique name of the task.
 * @param {string} taskConfig.description - A description of what the task does.
 * @param {any} [taskConfig.initialState] - Optional initial state for the task.
 * @param {Function} taskConfig.handler - The async function to execute the task's logic.
 *   It might receive arguments from the AI and should manage its own state/progress.
 */
export function useCopilotTask(taskConfig) {
  if (!taskConfig || typeof taskConfig !== 'object') {
    console.error('useCopilotTask: taskConfig is required and must be an object.');
    return { registered: false, name: null, error: 'Invalid configuration.' };
  }

  const { name, description, initialState, handler } = taskConfig;

  if (!name || typeof name !== 'string') {
    console.error('useCopilotTask: taskConfig.name is required and must be a string.');
    return { registered: false, name: null, error: 'Missing or invalid task name.' };
  }

  if (!description || typeof description !== 'string') {
    console.error(`useCopilotTask (${name}): taskConfig.description is required and must be a string.`);
    return { registered: false, name, error: 'Missing or invalid task description.' };
  }

  if (typeof handler !== 'function') {
    console.error(`useCopilotTask (${name}): taskConfig.handler is required and must be a function.`);
    return { registered: false, name, error: 'Missing or invalid task handler.' };
  }

  // Log the task registration (mocked)
  console.log(`[useCopilotTask] Registering task: ${name}`, { name, description, initialState: initialState !== undefined ? initialState : '(not set)', handler });

  // Add to our mock store
  const taskToRegister = {
    name,
    description,
    initialState, // Store it, though not actively used by this mock composable yet
    handler, // This is the async function
    // Potentially add other relevant parts of taskConfig if needed by a mock "runtime"
  };
  registeredTasks.push(taskToRegister);

  // Return value indicating success
  return {
    registered: true,
    name: name,
  };
}

// Helper functions for debugging/testing
export function getRegisteredTasks() {
  return [...registeredTasks];
}

export function clearRegisteredTasks() {
  registeredTasks.length = 0;
}

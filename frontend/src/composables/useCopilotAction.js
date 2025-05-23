// Mock store for registered actions
export const registeredActions = [];

/**
 * Composable to define and register a Copilot action.
 * This is a Vue equivalent to the React useCopilotAction hook.
 *
 * @param {object} actionConfig - Configuration for the action.
 * @param {string} actionConfig.name - The name of the action.
 * @param {string} actionConfig.description - A description of what the action does.
 * @param {Array<object>} [actionConfig.parameters] - Defines the parameters the action accepts.
 *   Each parameter object should have:
 *   - name (string): The name of the parameter.
 *   - type (string): The type of the parameter (e.g., 'string', 'number', 'boolean').
 *   - description (string): A description of the parameter.
 *   - (optional) enum (Array<string>): An array of possible values for the parameter.
 *   - (optional) required (boolean): Whether the parameter is required.
 * @param {Function} actionConfig.handler - The function to execute when the AI calls this action.
 *   It receives an object with arguments based on the defined parameters.
 *   It should return a result (e.g., a string) for the AI.
 */
export function useCopilotAction(actionConfig) {
  if (!actionConfig || typeof actionConfig !== 'object') {
    console.error('useCopilotAction: actionConfig is required and must be an object.');
    return { registered: false, name: null, error: 'Invalid configuration.' };
  }

  const { name, description, parameters, handler } = actionConfig;

  if (!name || typeof name !== 'string') {
    console.error('useCopilotAction: actionConfig.name is required and must be a string.');
    return { registered: false, name: null, error: 'Missing or invalid action name.' };
  }

  if (!description || typeof description !== 'string') {
    console.error(`useCopilotAction (${name}): actionConfig.description is required and must be a string.`);
    return { registered: false, name, error: 'Missing or invalid action description.' };
  }

  if (typeof handler !== 'function') {
    console.error(`useCopilotAction (${name}): actionConfig.handler is required and must be a function.`);
    return { registered: false, name, error: 'Missing or invalid action handler.' };
  }

  // Basic validation for parameters if provided
  if (parameters && !Array.isArray(parameters)) {
    console.error(`useCopilotAction (${name}): actionConfig.parameters must be an array if provided.`);
    return { registered: false, name, error: 'Invalid parameters definition.' };
  }
  if (parameters) {
    for (const param of parameters) {
      if (!param.name || typeof param.name !== 'string' ||
          !param.type || typeof param.type !== 'string' ||
          !param.description || typeof param.description !== 'string') {
        console.error(`useCopilotAction (${name}): Each parameter must have a name, type, and description.`);
        return { registered: false, name, error: 'Invalid parameter structure.' };
      }
    }
  }

  // Log the action registration (mocked)
  console.log(`[useCopilotAction] Registering action: ${name}`, actionConfig);

  // Add to our mock store
  const actionToRegister = {
    name,
    description,
    parameters: parameters || [], // Ensure parameters is always an array
    handler,
    // Potentially add other relevant parts of actionConfig if needed by the mock "runtime"
  };
  registeredActions.push(actionToRegister);

  // Return value indicating success (can be expanded later)
  return {
    registered: true,
    name: name,
  };
}

// Example of how to potentially access or list registered actions (for debugging/mocking purposes)
export function getRegisteredActions() {
  return [...registeredActions];
}

export function clearRegisteredActions() {
  registeredActions.length = 0;
}

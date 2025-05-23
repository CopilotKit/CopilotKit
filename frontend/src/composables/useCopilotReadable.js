import { ref, isRef, computed, watch, onUnmounted } from 'vue';

// Mock store for provided contexts
export const providedContexts = [];

// Helper to generate unique IDs
let idCounter = 0;
function generateUniqueId() {
  idCounter += 1;
  return `ctx_${Date.now()}_${idCounter}`;
}

/**
 * Composable to provide readable context to the Copilot.
 * This is a Vue equivalent to the React useCopilotReadable hook.
 *
 * @param {Ref<string> | ComputedRef<string> | Function | string} contextSource - The source of the context.
 *   Can be a Vue ref, computed property, a function returning a string, or a static string.
 * @param {string} [parentContextId] - Optional ID of a parent context (for hierarchical context - currently not fully implemented).
 */
export function useCopilotReadable(contextSource, parentContextId = null) {
  const contextId = generateUniqueId();
  let contextValue = null;
  let unwatch = null;

  const storeContext = (currentValue) => {
    const existingContext = providedContexts.find(c => c.id === contextId);
    if (existingContext) {
      existingContext.value = currentValue;
      existingContext.timestamp = Date.now();
      console.log(`[useCopilotReadable] Context ${contextId} updated:`, currentValue);
    } else {
      providedContexts.push({
        id: contextId,
        parentId: parentContextId,
        value: currentValue,
        sourceType: typeof contextSource,
        timestamp: Date.now(),
      });
      console.log(`[useCopilotReadable] Context ${contextId} provided:`, currentValue, parentContextId ? `(Parent: ${parentContextId})` : '');
    }
  };

  if (isRef(contextSource)) { // Handles both ref and computed properties
    contextValue = contextSource.value;
    storeContext(contextValue);
    unwatch = watch(contextSource, (newValue) => {
      storeContext(newValue);
    }, { deep: typeof contextSource.value === 'object' }); // deep watch for objects/arrays in refs
  } else if (typeof contextSource === 'function') {
    // For functions, we can make them computed to track their dependencies if they are reactive.
    // If it's a simple function without internal reactivity, it will be called once.
    const computedSource = computed(contextSource);
    contextValue = computedSource.value;
    storeContext(contextValue);
    unwatch = watch(computedSource, (newValue) => {
      storeContext(newValue);
    });
  } else if (typeof contextSource === 'string') {
    contextValue = contextSource;
    storeContext(contextValue);
    // No watch needed for static strings
  } else {
    console.error('[useCopilotReadable] Invalid contextSource type. Must be a ref, computed, function, or string.');
    return { contextId: null, error: 'Invalid contextSource type.' };
  }

  onUnmounted(() => {
    if (unwatch) {
      unwatch(); // Stop watching if a watcher was set up
    }
    const index = providedContexts.findIndex(c => c.id === contextId);
    if (index !== -1) {
      const removedContext = providedContexts.splice(index, 1);
      console.log(`[useCopilotReadable] Context ${contextId} removed:`, removedContext[0].value);
    }
  });

  return { contextId };
}

// Helper functions for debugging/testing
export function getProvidedContexts() {
  return [...providedContexts];
}

export function clearProvidedContexts() {
  providedContexts.length = 0;
  idCounter = 0; // Reset id counter as well
}

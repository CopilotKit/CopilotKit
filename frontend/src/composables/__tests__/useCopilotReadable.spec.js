import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref, computed, nextTick, onUnmounted as actualOnUnmounted } from 'vue';
import {
  useCopilotReadable,
  getProvidedContexts,
  clearProvidedContexts,
  providedContexts, // For direct inspection if needed
} from '../useCopilotReadable.js';

// Mock 'vue' to control onUnmounted
vi.mock('vue', async () => {
  const actualVue = await vi.importActual('vue');
  return {
    ...actualVue,
    onUnmounted: vi.fn((fn) => {
      // Store the cleanup function to call it manually in tests
      global.testCleanupHook = fn; 
    }),
  };
});

describe('useCopilotReadable.js', () => {
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    clearProvidedContexts();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    global.testCleanupHook = null; // Reset any stored cleanup hook
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Manually call the cleanup if it was registered and not called by a test
    // This is important if a test doesn't explicitly test unmounting
    if (global.testCleanupHook) {
        // console.log('Calling cleanup from afterEach');
        // global.testCleanupHook(); // This might be too broad, let tests handle their own cleanup
    }
    global.testCleanupHook = null;
  });

  // 1. Context Provisioning
  describe('Context Provisioning', () => {
    it('should provide context from a static string', () => {
      const staticString = 'Hello, Copilot!';
      const result = useCopilotReadable(staticString);
      const contexts = getProvidedContexts();
      
      expect(contexts).toHaveLength(1);
      expect(contexts[0].value).toBe(staticString);
      expect(contexts[0].id).toBe(result.contextId);
      expect(contexts[0].sourceType).toBe('string');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `[useCopilotReadable] Context ${result.contextId} provided:`,
        staticString,
        '' // No parent context id
      );
    });

    it('should provide context from a Vue ref', () => {
      const refValue = ref('Initial ref value');
      const result = useCopilotReadable(refValue);
      const contexts = getProvidedContexts();

      expect(contexts).toHaveLength(1);
      expect(contexts[0].value).toBe('Initial ref value');
      expect(contexts[0].id).toBe(result.contextId);
      expect(contexts[0].sourceType).toBe('object'); // Refs are objects
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should provide context from a Vue computed property', () => {
      const sourceRef = ref(10);
      const computedValue = computed(() => `Computed: ${sourceRef.value}`);
      const result = useCopilotReadable(computedValue);
      const contexts = getProvidedContexts();

      expect(contexts).toHaveLength(1);
      expect(contexts[0].value).toBe('Computed: 10');
      expect(contexts[0].id).toBe(result.contextId);
      expect(contexts[0].sourceType).toBe('object'); // Computed are objects (refs)
    });

    it('should provide context from a function returning a string', () => {
      const funcValue = () => 'Value from function';
      const result = useCopilotReadable(funcValue);
      const contexts = getProvidedContexts();

      expect(contexts).toHaveLength(1);
      expect(contexts[0].value).toBe('Value from function');
      expect(contexts[0].id).toBe(result.contextId);
      expect(contexts[0].sourceType).toBe('function');
    });

    it('should store parentContextId if provided', () => {
        useCopilotReadable("child context", "parent_123");
        const contexts = getProvidedContexts();
        expect(contexts[0].parentId).toBe("parent_123");
    });
  });

  // 2. Reactivity
  describe('Reactivity', () => {
    it('should update context when a Vue ref source changes', async () => {
      const myRef = ref('Old value');
      const { contextId } = useCopilotReadable(myRef);
      
      myRef.value = 'New value';
      await nextTick(); // Allow watcher to trigger

      const contexts = getProvidedContexts();
      const updatedContext = contexts.find(c => c.id === contextId);
      expect(updatedContext.value).toBe('New value');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `[useCopilotReadable] Context ${contextId} updated:`,
        'New value'
      );
    });

    it('should update context when a Vue computed source changes', async () => {
      const sourceRef = ref(5);
      const myComputed = computed(() => `Count: ${sourceRef.value}`);
      const { contextId } = useCopilotReadable(myComputed);

      sourceRef.value = 7;
      await nextTick();

      const contexts = getProvidedContexts();
      const updatedContext = contexts.find(c => c.id === contextId);
      expect(updatedContext.value).toBe('Count: 7');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `[useCopilotReadable] Context ${contextId} updated:`,
        'Count: 7'
      );
    });

    it('should update context when a function source (wrapped in computed) changes due to its dependencies', async () => {
      const depRef = ref('initial');
      const myFunction = () => `Function value: ${depRef.value}`;
      const { contextId } = useCopilotReadable(myFunction);

      depRef.value = 'changed';
      await nextTick();

      const contexts = getProvidedContexts();
      const updatedContext = contexts.find(c => c.id === contextId);
      expect(updatedContext.value).toBe('Function value: changed');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `[useCopilotReadable] Context ${contextId} updated:`,
        'Function value: changed'
      );
    });
  });

  // 3. Lifecycle Management (onUnmounted)
  describe('Lifecycle Management (onUnmounted)', () => {
    it('should remove context from store when onUnmounted callback is invoked', () => {
      const staticString = 'Temporary context';
      const { contextId } = useCopilotReadable(staticString);
      expect(getProvidedContexts()).toHaveLength(1);

      // Manually invoke the captured onUnmounted callback
      expect(global.testCleanupHook).toBeInstanceOf(Function);
      global.testCleanupHook(); 
      global.testCleanupHook = null; // Prevent afterEach from calling it again

      expect(getProvidedContexts()).toHaveLength(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `[useCopilotReadable] Context ${contextId} removed:`,
        staticString
      );
    });

    it('should stop watching reactive sources when onUnmounted callback is invoked', async () => {
        const myRef = ref('Watch me');
        const { contextId } = useCopilotReadable(myRef);
        expect(getProvidedContexts()).toHaveLength(1);
  
        // Manually invoke the captured onUnmounted callback
        expect(global.testCleanupHook).toBeInstanceOf(Function);
        global.testCleanupHook();
        global.testCleanupHook = null;
  
        expect(getProvidedContexts()).toHaveLength(0);
  
        // Change the ref's value AFTER unmounting
        myRef.value = 'Changed after unmount';
        await nextTick();
  
        // The console.log for update should NOT have been called for this change
        // Check the call count of consoleLogSpy for updates.
        // It should have been called once for provision, once for removal.
        // Any more calls would mean the watcher is still active.
        expect(consoleLogSpy.mock.calls.filter(call => call[0].includes('updated'))).toHaveLength(0);
      });
  });

  // 4. Return Value
  describe('Return Value', () => {
    it('should return an object with contextId on successful provision', () => {
      const result = useCopilotReadable('Test');
      expect(result).toHaveProperty('contextId');
      expect(result.contextId).toMatch(/^ctx_\d+_\d+$/);
    });

    it('should return { contextId: null, error: ... } for invalid contextSource type', () => {
      const result = useCopilotReadable(12345); // Number is an invalid type
      expect(result.contextId).toBeNull();
      expect(result.error).toBe('Invalid contextSource type.');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[useCopilotReadable] Invalid contextSource type. Must be a ref, computed, function, or string.'
      );
      expect(getProvidedContexts()).toHaveLength(0);
    });
  });

  // 5. Helper Functions
  describe('Helper Functions', () => {
    it('getProvidedContexts() should return the current list of contexts', () => {
      useCopilotReadable('ctx1');
      useCopilotReadable(ref('ctx2'));
      const contexts = getProvidedContexts();
      expect(contexts).toHaveLength(2);
    });

    it('getProvidedContexts() should return a copy, not the original array', () => {
        useCopilotReadable('ctx1');
        const contexts1 = getProvidedContexts();
        contexts1.push({ id: 'mutated', value: 'mutated' }); // Try to mutate
        
        const contexts2 = getProvidedContexts();
        expect(contexts2).toHaveLength(1); // Should still be 1
        expect(contexts2[0].value).toBe('ctx1');

        expect(providedContexts).toHaveLength(1); // Internal store check
    });

    it('clearProvidedContexts() should empty the providedContexts array and reset idCounter', () => {
      useCopilotReadable('ctx1');
      useCopilotReadable(ref('ctx2'));
      expect(getProvidedContexts()).toHaveLength(2);
      
      clearProvidedContexts();
      expect(getProvidedContexts()).toHaveLength(0);

      // Check if idCounter is reset (indirectly, by checking new ID format)
      const result = useCopilotReadable('another one');
      // The counter part of the ID should be small (e.g., 1) if reset
      expect(result.contextId).toMatch(/^ctx_\d+_1$/); 
    });
  });
});

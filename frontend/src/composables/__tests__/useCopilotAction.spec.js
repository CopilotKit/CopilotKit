import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useCopilotAction,
  getRegisteredActions,
  clearRegisteredActions,
  registeredActions, // Import for direct inspection if needed, though getRegisteredActions is preferred
} from '../useCopilotAction.js';

describe('useCopilotAction.js', () => {
  let consoleErrorSpy;
  let consoleLogSpy; // The composable uses console.log for registration messages

  beforeEach(() => {
    // Clear actions before each test to ensure independence
    clearRegisteredActions();
    // Spy on console methods
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore original console methods
    vi.restoreAllMocks();
  });

  // 1. Action Registration (Mocked Store)
  describe('Action Registration', () => {
    const validActionConfig = {
      name: 'testAction',
      description: 'A valid test action.',
      parameters: [
        { name: 'param1', type: 'string', description: 'A string parameter.' },
      ],
      handler: async () => { console.log('handler called'); },
    };

    it('should add a valid action to the registeredActions array', () => {
      useCopilotAction(validActionConfig);
      const actions = getRegisteredActions();
      expect(actions).toHaveLength(1);
      // Check structure, ensuring parameters defaults to empty array if not provided
      expect(actions[0]).toEqual(expect.objectContaining({
        name: validActionConfig.name,
        description: validActionConfig.description,
        parameters: validActionConfig.parameters, // or [] if parameters were optional and not provided
        handler: validActionConfig.handler,
      }));
    });

    it('should default parameters to an empty array if not provided in config', () => {
        const actionWithoutParams = {
            name: 'actionNoParams',
            description: 'Action without parameters.',
            handler: async () => {},
        };
        useCopilotAction(actionWithoutParams);
        const actions = getRegisteredActions();
        expect(actions[0].parameters).toEqual([]);
    });

    it('should log registration message on success', () => {
      useCopilotAction(validActionConfig);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[useCopilotAction] Registering action: testAction',
        expect.any(Object) // The config object
      );
    });
  });

  // 2. Validation Logic
  describe('Validation Logic', () => {
    const baseValidConfig = {
        name: 'validName',
        description: 'validDescription',
        handler: () => {},
    };

    it('should not register and log error if actionConfig is missing or not an object', () => {
      const result1 = useCopilotAction(null);
      expect(consoleErrorSpy).toHaveBeenCalledWith('useCopilotAction: actionConfig is required and must be an object.');
      expect(result1.registered).toBe(false);
      expect(result1.error).toBe('Invalid configuration.');

      const result2 = useCopilotAction('not an object');
      expect(consoleErrorSpy).toHaveBeenCalledWith('useCopilotAction: actionConfig is required and must be an object.');
      expect(result2.registered).toBe(false);
      expect(result2.error).toBe('Invalid configuration.');
      
      expect(getRegisteredActions()).toHaveLength(0);
    });

    it('should not register and log error if name is missing or not a string', () => {
      const result1 = useCopilotAction({ ...baseValidConfig, name: null });
      expect(consoleErrorSpy).toHaveBeenCalledWith('useCopilotAction: actionConfig.name is required and must be a string.');
      expect(result1.registered).toBe(false);
      expect(result1.error).toBe('Missing or invalid action name.');

      const result2 = useCopilotAction({ ...baseValidConfig, name: 123 });
      expect(consoleErrorSpy).toHaveBeenCalledWith('useCopilotAction: actionConfig.name is required and must be a string.');
      expect(result2.registered).toBe(false);
      expect(result2.error).toBe('Missing or invalid action name.');

      expect(getRegisteredActions()).toHaveLength(0);
    });

    it('should not register and log error if description is missing or not a string', () => {
      const result = useCopilotAction({ ...baseValidConfig, description: null });
      expect(consoleErrorSpy).toHaveBeenCalledWith(`useCopilotAction (${baseValidConfig.name}): actionConfig.description is required and must be a string.`);
      expect(result.registered).toBe(false);
      expect(result.error).toBe('Missing or invalid action description.');
      expect(getRegisteredActions()).toHaveLength(0);
    });

    it('should not register and log error if handler is missing or not a function', () => {
      const result = useCopilotAction({ ...baseValidConfig, handler: null });
      expect(consoleErrorSpy).toHaveBeenCalledWith(`useCopilotAction (${baseValidConfig.name}): actionConfig.handler is required and must be a function.`);
      expect(result.registered).toBe(false);
      expect(result.error).toBe('Missing or invalid action handler.');
      expect(getRegisteredActions()).toHaveLength(0);
    });

    it('should not register and log error if parameters is provided but not an array', () => {
        const result = useCopilotAction({ ...baseValidConfig, parameters: "not-an-array" });
        expect(consoleErrorSpy).toHaveBeenCalledWith(`useCopilotAction (${baseValidConfig.name}): actionConfig.parameters must be an array if provided.`);
        expect(result.registered).toBe(false);
        expect(result.error).toBe('Invalid parameters definition.');
        expect(getRegisteredActions()).toHaveLength(0);
    });
    
    it('should not register and log error if a parameter has invalid structure', () => {
        const invalidParams = [
            { name: 'param1', type: 'string' /* missing description */ },
        ];
        const result = useCopilotAction({ ...baseValidConfig, parameters: invalidParams });
        expect(consoleErrorSpy).toHaveBeenCalledWith(`useCopilotAction (${baseValidConfig.name}): Each parameter must have a name, type, and description.`);
        expect(result.registered).toBe(false);
        expect(result.error).toBe('Invalid parameter structure.');
        expect(getRegisteredActions()).toHaveLength(0);
    });
  });

  // 3. Return Value
  describe('Return Value', () => {
    it('should return { registered: true, name: actionName } on successful registration', () => {
      const actionConfig = { name: 'successAction', description: 'desc', handler: () => {} };
      const result = useCopilotAction(actionConfig);
      expect(result).toEqual({ registered: true, name: 'successAction' });
    });

    it('should return { registered: false, name: ..., error: ... } on validation failure', () => {
      const result = useCopilotAction({ description: 'desc', handler: () => {} }); // Missing name
      expect(result.registered).toBe(false);
      expect(result.name).toBeNull(); // Or the invalid name if provided
      expect(result.error).toBe('Missing or invalid action name.');
    });
  });

  // 4. Helper Functions
  describe('Helper Functions', () => {
    const action1 = { name: 'action1', description: 'd1', handler: () => {} };
    const action2 = { name: 'action2', description: 'd2', handler: () => {} };

    it('getRegisteredActions() should return the current list of actions', () => {
      useCopilotAction(action1);
      useCopilotAction(action2);
      const actions = getRegisteredActions();
      expect(actions).toHaveLength(2);
      expect(actions[0].name).toBe('action1');
      expect(actions[1].name).toBe('action2');
    });

    it('getRegisteredActions() should return a copy, not the original array', () => {
        useCopilotAction(action1);
        const actions1 = getRegisteredActions();
        actions1.push({ name: 'mutatedAction', description: 'mutated', handler: () => {} });
        
        const actions2 = getRegisteredActions();
        expect(actions2).toHaveLength(1); // Should still be 1 if it's a copy
        expect(actions2[0].name).toBe('action1');

        // Also check internal store directly to be sure
        expect(registeredActions).toHaveLength(1); 
    });

    it('clearRegisteredActions() should empty the registeredActions array', () => {
      useCopilotAction(action1);
      useCopilotAction(action2);
      expect(getRegisteredActions()).toHaveLength(2);
      
      clearRegisteredActions();
      expect(getRegisteredActions()).toHaveLength(0);
    });
  });
});

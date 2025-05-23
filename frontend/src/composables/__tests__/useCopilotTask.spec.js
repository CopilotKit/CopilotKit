import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useCopilotTask,
  getRegisteredTasks,
  clearRegisteredTasks,
  registeredTasks, // Import for direct inspection if needed
} from '../useCopilotTask.js';

describe('useCopilotTask.js', () => {
  let consoleErrorSpy;
  let consoleLogSpy; // The composable uses console.log for registration messages

  beforeEach(() => {
    clearRegisteredTasks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockAsyncTaskHandler = async (args) => {
    console.log('Mock task handler executed with:', args);
    return 'Task completed';
  };

  const validTaskConfig = {
    name: 'myTestTask',
    description: 'A task for testing purposes.',
    initialState: { status: 'pending' },
    handler: mockAsyncTaskHandler,
  };

  // 1. Task Registration (Mocked Store)
  describe('Task Registration', () => {
    it('should add a valid task to the registeredTasks array', () => {
      useCopilotTask(validTaskConfig);
      const tasks = getRegisteredTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toEqual(expect.objectContaining({
        name: validTaskConfig.name,
        description: validTaskConfig.description,
        initialState: validTaskConfig.initialState,
        handler: validTaskConfig.handler,
      }));
    });

    it('should store initialState as undefined if not provided', () => {
        const configNoInitialState = { ...validTaskConfig, initialState: undefined };
        useCopilotTask(configNoInitialState);
        const tasks = getRegisteredTasks();
        expect(tasks[0].initialState).toBeUndefined();
    });
    
    it('should store initialState as null if provided as null', () => {
        const configNullInitialState = { ...validTaskConfig, initialState: null };
        useCopilotTask(configNullInitialState);
        const tasks = getRegisteredTasks();
        expect(tasks[0].initialState).toBeNull();
    });

    it('should log registration message on success', () => {
      useCopilotTask(validTaskConfig);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[useCopilotTask] Registering task: myTestTask',
        expect.objectContaining({
            name: validTaskConfig.name,
            description: validTaskConfig.description,
            initialState: validTaskConfig.initialState
        })
      );
    });
  });

  // 2. Validation Logic
  describe('Validation Logic', () => {
    const baseValidConfig = {
        name: 'validName',
        description: 'validDescription',
        handler: mockAsyncTaskHandler,
    };

    it('should not register and log error if taskConfig is missing or not an object', () => {
      const result1 = useCopilotTask(null);
      expect(consoleErrorSpy).toHaveBeenCalledWith('useCopilotTask: taskConfig is required and must be an object.');
      expect(result1.registered).toBe(false);
      expect(result1.error).toBe('Invalid configuration.');

      const result2 = useCopilotTask('not an object');
      expect(consoleErrorSpy).toHaveBeenCalledWith('useCopilotTask: taskConfig is required and must be an object.');
      expect(result2.registered).toBe(false);
      expect(result2.error).toBe('Invalid configuration.');
      
      expect(getRegisteredTasks()).toHaveLength(0);
    });

    it('should not register and log error if name is missing or not a string', () => {
      const result1 = useCopilotTask({ ...baseValidConfig, name: null });
      expect(consoleErrorSpy).toHaveBeenCalledWith('useCopilotTask: taskConfig.name is required and must be a string.');
      expect(result1.registered).toBe(false);
      expect(result1.error).toBe('Missing or invalid task name.');

      const result2 = useCopilotTask({ ...baseValidConfig, name: 123 });
      expect(consoleErrorSpy).toHaveBeenCalledWith('useCopilotTask: taskConfig.name is required and must be a string.');
      expect(result2.registered).toBe(false);
      expect(result2.error).toBe('Missing or invalid task name.');

      expect(getRegisteredTasks()).toHaveLength(0);
    });

    it('should not register and log error if description is missing or not a string', () => {
      const result = useCopilotTask({ ...baseValidConfig, description: null });
      expect(consoleErrorSpy).toHaveBeenCalledWith(`useCopilotTask (${baseValidConfig.name}): taskConfig.description is required and must be a string.`);
      expect(result.registered).toBe(false);
      expect(result.error).toBe('Missing or invalid task description.');
      expect(getRegisteredTasks()).toHaveLength(0);
    });

    it('should not register and log error if handler is missing or not a function', () => {
      const result = useCopilotTask({ ...baseValidConfig, handler: null });
      expect(consoleErrorSpy).toHaveBeenCalledWith(`useCopilotTask (${baseValidConfig.name}): taskConfig.handler is required and must be a function.`);
      expect(result.registered).toBe(false);
      expect(result.error).toBe('Missing or invalid task handler.');
      expect(getRegisteredTasks()).toHaveLength(0);
    });
  });

  // 3. Return Value
  describe('Return Value', () => {
    it('should return { registered: true, name: taskName } on successful registration', () => {
      const result = useCopilotTask(validTaskConfig);
      expect(result).toEqual({ registered: true, name: validTaskConfig.name });
    });

    it('should return { registered: false, name: ..., error: ... } on validation failure', () => {
      const result = useCopilotTask({ description: 'desc', handler: mockAsyncTaskHandler }); // Missing name
      expect(result.registered).toBe(false);
      expect(result.name).toBeNull();
      expect(result.error).toBe('Missing or invalid task name.');
    });
  });

  // 4. Handler Function Reference
  describe('Handler Function', () => {
    it('should store the exact handler function provided in the config', () => {
      useCopilotTask(validTaskConfig);
      const tasks = getRegisteredTasks();
      expect(tasks[0].handler).toBe(mockAsyncTaskHandler); // Check for reference equality
    });
  });

  // 5. Helper Functions
  describe('Helper Functions', () => {
    const task1Config = { name: 'task1', description: 'd1', handler: async () => {} };
    const task2Config = { name: 'task2', description: 'd2', handler: async () => {} };

    it('getRegisteredTasks() should return the current list of tasks', () => {
      useCopilotTask(task1Config);
      useCopilotTask(task2Config);
      const tasks = getRegisteredTasks();
      expect(tasks).toHaveLength(2);
      expect(tasks[0].name).toBe('task1');
      expect(tasks[1].name).toBe('task2');
    });

    it('getRegisteredTasks() should return a copy, not the original array', () => {
        useCopilotTask(task1Config);
        const tasks1 = getRegisteredTasks();
        tasks1.push({ name: 'mutatedTask', description: 'mutated', handler: async () => {} });
        
        const tasks2 = getRegisteredTasks();
        expect(tasks2).toHaveLength(1); // Should still be 1 if it's a copy
        expect(tasks2[0].name).toBe('task1');

        expect(registeredTasks).toHaveLength(1); // Internal store check
    });

    it('clearRegisteredTasks() should empty the registeredTasks array', () => {
      useCopilotTask(task1Config);
      useCopilotTask(task2Config);
      expect(getRegisteredTasks()).toHaveLength(2);
      
      clearRegisteredTasks();
      expect(getRegisteredTasks()).toHaveLength(0);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CopilotKitCore } from '../core';
import { FrontendTool } from '../types';
import { MockAgent, createAssistantMessage } from './test-utils';

describe('CopilotKitCore - Agent Constraints', () => {
  it('should add tool with agentId', () => {
    const core = new CopilotKitCore({
      headers: {},
      properties: {},
    });
    
    const tool: FrontendTool = {
      name: 'testTool',
      handler: vi.fn(),
      agentId: 'agent1',
    };
    
    core.addTool(tool);
    const retrievedTool = core.getTool({ toolName: 'testTool', agentId: 'agent1' });
    expect(retrievedTool).toBeDefined();
    expect(retrievedTool?.agentId).toBe('agent1');
  });

  it('should add multiple tools with different agentIds', () => {
    const core = new CopilotKitCore({
      headers: {},
      properties: {},
    });
    
    const globalTool: FrontendTool = {
      name: 'globalTool',
      handler: vi.fn(),
    };
    
    const agent1Tool: FrontendTool = {
      name: 'agent1Tool',
      handler: vi.fn(),
      agentId: 'agent1',
    };
    
    const agent2Tool: FrontendTool = {
      name: 'agent2Tool',
      handler: vi.fn(),
      agentId: 'agent2',
    };
    
    core.addTool(globalTool);
    core.addTool(agent1Tool);
    core.addTool(agent2Tool);
    
    const retrievedGlobalTool = core.getTool({ toolName: 'globalTool' });
    expect(retrievedGlobalTool).toBeDefined();
    expect(retrievedGlobalTool?.agentId).toBeUndefined();
    
    const retrievedAgent1Tool = core.getTool({ toolName: 'agent1Tool', agentId: 'agent1' });
    expect(retrievedAgent1Tool).toBeDefined();
    expect(retrievedAgent1Tool?.agentId).toBe('agent1');
    
    const retrievedAgent2Tool = core.getTool({ toolName: 'agent2Tool', agentId: 'agent2' });
    expect(retrievedAgent2Tool).toBeDefined();
    expect(retrievedAgent2Tool?.agentId).toBe('agent2');
  });

  it('should preserve all FrontendTool properties including agentId', () => {
    const core = new CopilotKitCore({
      headers: {},
      properties: {},
    });
    
    const handler = vi.fn(async () => 'result');
    const tool: FrontendTool = {
      name: 'fullTool',
      description: 'A complete tool',
      handler,
      followUp: false,
      agentId: 'specificAgent',
    };
    
    core.addTool(tool);
    
    const addedTool = core.getTool({ toolName: 'fullTool', agentId: 'specificAgent' });
    expect(addedTool).toBeDefined();
    expect(addedTool?.name).toBe('fullTool');
    expect(addedTool?.description).toBe('A complete tool');
    expect(addedTool?.handler).toBe(handler);
    expect(addedTool?.followUp).toBe(false);
    expect(addedTool?.agentId).toBe('specificAgent');
  });
});
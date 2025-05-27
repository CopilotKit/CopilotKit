'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';

// Define the type for an agent
export interface Agent {
  name: string;
  // Add other agent properties as needed
}

// Define the context type
interface AgentContextType {
  selectedAgent: Agent;
  setSelectedAgent: (agent: Agent ) => void;
}

// Create the context
const AgentContext = createContext<AgentContextType | undefined>(undefined);

// Create the provider component
export function AgentProvider({ children }: { children: ReactNode }) {
  const [selectedAgent, setSelectedAgent] = useState<Agent>({name : "langgraphAgent"});

  return (
    <AgentContext.Provider value={{ selectedAgent, setSelectedAgent }}>
      {children}
    </AgentContext.Provider>
  );
}

// Create a custom hook to use the agent context
export function useAgent() {
  const context = useContext(AgentContext);
  if (context === undefined) {
    throw new Error('useAgent must be used within an AgentProvider');
  }
  return context;
}

import React, { createContext, useContext, useState, ReactNode } from "react";

// Define the shape of an agent. Adjust as needed for your app.
export type Agent = {
  id: string;
  name: string;
  // Add other agent properties as needed
};

// Context value type
type AgentContextType = {
  currentAgent: Agent | null;
  setAgent: (agent: Agent) => void;
  agents: Agent[];
  setAgents: (agents: Agent[]) => void;
};

const AgentContext = createContext<AgentContextType | undefined>(undefined);

export const AgentProvider = ({ children }: { children: ReactNode }) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [currentAgent, setCurrentAgent] = useState<Agent>({id : "langgraphAgent", name : "Researcher - LangGraph"});

  const setAgent = (agent: Agent) => {
    setCurrentAgent(agent);
  };

  return (
    <AgentContext.Provider value={{ currentAgent, setAgent, agents, setAgents }}>
      {children}
    </AgentContext.Provider>
  );
};

export const useAgent = () => {
  const context = useContext(AgentContext);
  if (!context) {
    throw new Error("useAgent must be used within an AgentProvider");
  }
  return context;
};

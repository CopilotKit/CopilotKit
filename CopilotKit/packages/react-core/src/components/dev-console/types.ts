/**
 * Shared type definitions for the developer console
 */

export interface ActionParameter {
  name: string;
  required?: boolean;
  type?: string;
}

export interface Action {
  name: string;
  description?: string;
  parameters?: ActionParameter[];
  status?: string;
}

export interface Readable {
  name?: string;
  description?: string;
  value?: any;
  content?: string;
  metadata?: Record<string, any>;
}

export interface AgentState {
  status?: string;
  state?: any;
  running?: boolean;
  lastUpdate?: number;
}

export interface Message {
  id?: string;
  role?: "user" | "assistant" | "system";
  content?: string;
  timestamp?: number;
  [key: string]: any; // Allow additional properties from CopilotKit
}

export interface Document {
  name?: string;
  content?: string;
  metadata?: Record<string, any>;
}

export interface DisplayContext {
  actions: Record<string, Action>;
  getAllContext: () => Readable[];
  coagentStates: Record<string, AgentState>;
  getDocumentsContext: (args?: any[]) => Document[];
}

export interface MessagesContext {
  messages: Message[];
}

export interface InspectorMessage {
  id: string;
  title: string;
  description?: string;
  severity: "info" | "warning" | "error";
  showOnBadge?: boolean; // If true, this contributes to the outer badge count
  url?: string;
  timestamp?: number;
}

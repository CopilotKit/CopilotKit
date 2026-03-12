// Define common properties that all event objects share
export interface BaseWebhookEvent {
  id?: string; // ID might not be present in all events
  timestamp?: string; // Timestamp might not be present in all events
  // Any other common fields across all event types
}

// Specific event types
export interface FlowStartedEvent extends BaseWebhookEvent {
  flow_id: string;
  // Additional flow_started specific fields
}

export interface FlowFinishedEvent extends BaseWebhookEvent {
  flow_id: string;
  // Additional flow_finished specific fields
}

export interface CrewKickoffStartedEvent extends BaseWebhookEvent {
  // Crew kickoff specific fields
}

export interface CrewKickoffCompletedEvent extends BaseWebhookEvent {
  // Crew kickoff completed specific fields
}

export interface LLMCallStartedEvent extends BaseWebhookEvent {
  // LLM call started specific fields
}

export interface LLMCallCompletedEvent extends BaseWebhookEvent {
  // LLM call completed specific fields
}

export interface MethodExecutionStartedEvent extends BaseWebhookEvent {
  method_name?: string;
  // Method execution started specific fields
}

export interface MethodExecutionFinishedEvent extends BaseWebhookEvent {
  method_name?: string;
  result?: any;
  // Method execution finished specific fields
}

// Define the structure for any unknown event types
export interface UnknownEvent extends BaseWebhookEvent {
  [key: string]: any; // Allow any additional properties
}

// Type for supported event types
export type WebhookEventType =
  | "flow_started"
  | "flow_finished"
  | "crew_kickoff_started"
  | "crew_kickoff_completed"
  | "llm_call_started"
  | "llm_call_completed"
  | "method_execution_started"
  | "method_execution_finished"
  // Add any other event types we might receive
  | string; // Allow for unknown event types

// Map event types to their corresponding event interfaces
export interface WebhookEventMap {
  flow_started: FlowStartedEvent[];
  flow_finished: FlowFinishedEvent[];
  crew_kickoff_started: CrewKickoffStartedEvent[];
  crew_kickoff_completed: CrewKickoffCompletedEvent[];
  llm_call_started: LLMCallStartedEvent[];
  llm_call_completed: LLMCallCompletedEvent[];
  method_execution_started: MethodExecutionStartedEvent[];
  method_execution_finished: MethodExecutionFinishedEvent[];
  [key: string]: UnknownEvent[]; // Allow for any other event types
}

// The full webhook response structure
export interface WebhookResponse {
  // Normal case: Direct dictionary of event types
  [eventType: string]: BaseWebhookEvent[];
}

// Alternative structure we sometimes see
export interface WebhookResponseWithValue {
  value: {
    [eventType: string]: BaseWebhookEvent[];
  };
  type?: string;
  name?: string;
}

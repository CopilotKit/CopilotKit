/**
 * Wire DTOs emitted by the .NET Control Room agent.
 *
 * These types intentionally mirror the snake_case property names produced by
 * the Microsoft Agent Framework backend so that JSON payloads can be consumed
 * without an intermediate transform layer.
 */

export type ControlRoomMode = "Plan" | "Act" | "Review";

export interface ControlRoomTodo {
  id: string;
  label: string;
  status: "pending" | "in_progress" | "completed";
}

export interface ControlRoomMemoryEntry {
  key: string;
  value: string;
}

export interface ControlRoomFeatureSupport {
  native: string[];
  live_wrappers: string[];
}

export interface ControlRoomObserverSnapshotDto {
  repo_file_count: number;
  latest_test_command?: string | null;
  latest_test_success?: boolean | null;
}

export interface ControlRoomSkill {
  /** Stable identifier — matches the `skillName` arg on Harness tool calls. */
  name: string;
  /** Last observed activity for the skill: load, resource read, or script run. */
  lastActivity: "loaded" | "resource_read" | "script_run";
  /** Last `read_skill_resource` / `run_skill_script` argument (resource/script id). */
  lastDetail?: string | null;
  /** Number of times the skill was touched this session. */
  invocations: number;
}

export interface StructuredDiagnosisRecord {
  /** ID of the assistant message that carried the structured response. */
  messageId: string;
  /** Parsed JSON payload — typed against the FixtureDiagnosis schema. */
  payload: import("./fixture-diagnosis-schema").FixtureDiagnosis;
  /** Original raw text from the assistant message (kept for the inspector). */
  raw: string;
}

export interface ControlRoomStateSnapshot {
  mode: ControlRoomMode;
  todos: ControlRoomTodo[];
  memory: ControlRoomMemoryEntry[];
  skills?: ControlRoomSkill[];
  structuredDiagnosis?: StructuredDiagnosisRecord | null;
  observers?: ControlRoomObserverSnapshotDto | null;
  features?: ControlRoomFeatureSupport | null;
}

export interface FileEntry {
  path: string;
  size: number;
}

export interface ApprovalRequest {
  request_id: string;
  action_label: "shell_execution" | "file_write" | "patch_application";
  payload_summary: string;
  status: "pending" | "approved" | "rejected" | "consumed";
  approval_token: string | null;
  created_at_utc: string;
  resolved_at_utc: string | null;
}

export interface TestStatus {
  command: string;
  success: boolean;
  exit_code: number;
  summary: string;
  updated_at_utc: string;
}

export interface ToolCallSummary {
  tool_name: string;
  summary: string;
  created_at_utc: string;
}

export interface StateSnapshotValidity {
  is_valid: boolean;
  summary: string;
  updated_at_utc: string;
}

export interface ConnectionMetadata {
  connection_id: string;
  client_name: string;
  connected_at_utc: string;
  last_seen_at_utc: string;
}

export interface ObserverSnapshot {
  repo_files: FileEntry[];
  latest_test_status: TestStatus | null;
  latest_tool_call_summaries: ToolCallSummary[];
  latest_state_snapshot_validity: StateSnapshotValidity | null;
  connections: ConnectionMetadata[];
}

export interface CommandExecutionResult {
  command: string;
  success: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  started_at_utc: string;
  finished_at_utc: string;
}

export interface FeatureSupportPayload {
  native: string[];
  live_wrappers: string[];
}

export interface FixtureResetResult {
  reset: boolean;
  file_count: number;
}

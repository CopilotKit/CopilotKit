/** JSON values accepted by developer events. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** One browser payload. The authorized channel supplies its Trajectory scope. */
export interface TrajectoryEvent<V = JsonValue> {
  type: "CUSTOM";
  name: string;
  timestamp: number;
  value: V;
}

export type StartResult =
  | { status: "started"; trajectoryId: string }
  | { status: "error"; code: string };

export interface ConnectionGrant {
  joinToken: string;
  realtime: { clientUrl: string; topic: string };
}

export interface TrajectoryError {
  code: string;
  message: string;
}

export interface TrajectoryCaptureOptions {
  /** Only matching configured templates leave the browser. Other routes are null. */
  routes?: string[];
  capture?: { clicks?: boolean; navigation?: boolean };
  /** Runs in the browser before validation and delivery. Return null to discard. */
  beforeSend?: (event: TrajectoryEvent) => TrajectoryEvent | null;
  /** Reports rejected events or delivery failures without interrupting the app. */
  onError?: (error: TrajectoryError) => void;
}

export interface TrajectoryCollector {
  start(): void;
  stop(): void;
  emit(name: string, value: JsonValue): void;
}

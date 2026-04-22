import * as http from "node:http";
import * as https from "node:https";
import { DebugEventEnvelope, ConnectionStatus } from "./inspector-types";

type EventCallback = (envelope: DebugEventEnvelope) => void;
type StatusCallback = (status: ConnectionStatus) => void;
type ErrorCallback = (error: string) => void;

export class DebugStream {
  private eventCallbacks: EventCallback[] = [];
  private statusCallbacks: StatusCallback[] = [];
  private errorCallbacks: ErrorCallback[] = [];
  private request: http.ClientRequest | null = null;
  private status: ConnectionStatus = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private shouldReconnect = false;

  onEvent(cb: EventCallback): () => void {
    this.eventCallbacks.push(cb);
    return () => {
      this.eventCallbacks = this.eventCallbacks.filter((c) => c !== cb);
    };
  }

  onStatus(cb: StatusCallback): () => void {
    this.statusCallbacks.push(cb);
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter((c) => c !== cb);
    };
  }

  onError(cb: ErrorCallback): () => void {
    this.errorCallbacks.push(cb);
    return () => {
      this.errorCallbacks = this.errorCallbacks.filter((c) => c !== cb);
    };
  }

  connect(runtimeUrl: string): void {
    this.disconnect();
    this.shouldReconnect = true;
    this.reconnectDelay = 1000;
    this.doConnect(runtimeUrl);
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.request) {
      this.request.destroy();
      this.request = null;
    }
    this.setStatus("disconnected");
  }

  dispose(): void {
    this.disconnect();
    this.eventCallbacks = [];
    this.statusCallbacks = [];
    this.errorCallbacks = [];
  }

  private emitError(error: string): void {
    for (const cb of this.errorCallbacks) {
      cb(error);
    }
  }

  private doConnect(runtimeUrl: string): void {
    this.setStatus("connecting");

    let url: URL;
    try {
      const base = runtimeUrl.endsWith("/") ? runtimeUrl : runtimeUrl + "/";
      url = new URL("cpk-debug-events", base);
    } catch {
      this.emitError(`Invalid URL: ${runtimeUrl}`);
      this.handleDisconnect(runtimeUrl);
      return;
    }

    const mod = url.protocol === "https:" ? https : http;

    const req = mod.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        this.emitError(
          `Server returned ${res.statusCode}${res.statusCode === 404 ? " — debug endpoint not found. Is the runtime running in development mode?" : ""}`,
        );
        this.handleDisconnect(runtimeUrl);
        return;
      }

      this.setStatus("connected");
      this.reconnectDelay = 1000;

      let buffer = "";

      res.setEncoding("utf-8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const envelope = JSON.parse(line.slice(6)) as DebugEventEnvelope;
              for (const cb of this.eventCallbacks) {
                cb(envelope);
              }
            } catch (parseErr) {
              // Include the underlying JSON error so the user can tell a
              // truncated SSE frame apart from a version-mismatched
              // runtime (different shapes produce different parse errors).
              const reason =
                parseErr instanceof Error ? parseErr.message : String(parseErr);
              this.emitError(
                `Failed to parse event (${reason}): ${line.slice(6, 200)}${line.length > 206 ? "..." : ""}`,
              );
            }
          }
        }
      });

      res.on("end", () => {
        this.handleDisconnect(runtimeUrl);
      });

      res.on("error", (err) => {
        this.emitError(`Stream error: ${err.message}`);
        this.handleDisconnect(runtimeUrl);
      });
    });

    req.on("error", (err) => {
      this.emitError(`Connection failed: ${err.message}`);
      this.handleDisconnect(runtimeUrl);
    });

    this.request = req;
  }

  private handleDisconnect(runtimeUrl: string): void {
    this.request = null;
    this.setStatus("disconnected");

    if (this.shouldReconnect) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.doConnect(runtimeUrl);
      }, this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000);
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const cb of this.statusCallbacks) {
      cb(status);
    }
  }
}

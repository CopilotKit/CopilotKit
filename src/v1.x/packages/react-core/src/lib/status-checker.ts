import {
  COPILOT_CLOUD_API_URL,
  COPILOT_CLOUD_PUBLIC_API_KEY_HEADER,
  Severity,
} from "@copilotkit/shared";

const STATUS_CHECK_INTERVAL = 1000 * 60 * 5; // 5 minutes

export type Status = {
  severity: Severity;
  message: string;
};

export class StatusChecker {
  private activeKey: string | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private instanceCount = 0;
  private lastResponse: Status | null = null;

  async start(publicApiKey: string, onUpdate?: (status: Status | null) => void) {
    this.instanceCount++;
    if (this.activeKey === publicApiKey) return;

    if (this.intervalId) clearInterval(this.intervalId);

    const checkStatus = async () => {
      try {
        const response = await fetch(`${COPILOT_CLOUD_API_URL}/ciu`, {
          method: "GET",
          headers: {
            [COPILOT_CLOUD_PUBLIC_API_KEY_HEADER]: publicApiKey,
          },
        }).then((response) => response.json() as Promise<Status>);
        this.lastResponse = response;
        onUpdate?.(response);
        return response;
      } catch (error) {
        // Silently fail
        return null;
      }
    };

    const initialResponse = await checkStatus();
    this.intervalId = setInterval(checkStatus, STATUS_CHECK_INTERVAL);
    this.activeKey = publicApiKey;
    return initialResponse;
  }

  getLastResponse() {
    return this.lastResponse;
  }

  stop() {
    this.instanceCount--;
    if (this.instanceCount === 0) {
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
        this.activeKey = null;
        this.lastResponse = null;
      }
    }
  }
}

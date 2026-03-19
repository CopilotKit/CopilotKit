import * as packageJson from "../../package.json";

const SCARF_BASE_URL = `https://copilotkit.gateway.scarf.sh/${packageJson.version}`;

class ScarfClient {
  constructor() {}

  async logEvent(properties: Record<string, any>): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const queryParams = new URLSearchParams();

      Object.entries(properties).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          queryParams.append(key, String(value));
        }
      });

      const url = `${SCARF_BASE_URL}?${queryParams.toString()}`;

      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch {
      // Silently fail - telemetry should not break the application
    }
  }
}

export default new ScarfClient();

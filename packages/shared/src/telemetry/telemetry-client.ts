import { AnalyticsEvents } from "./events";
import { flattenObject } from "./utils";
import { v4 as uuidv4 } from "uuid";


export function isTelemetryDisabled(): boolean {
  const env = process.env as Record<string, string | undefined>;

  return (
    env.COPILOTKIT_TELEMETRY_DISABLED === "true" ||
    env.COPILOTKIT_TELEMETRY_DISABLED === "1" ||
    env.DO_NOT_TRACK === "true" ||
    env.DO_NOT_TRACK === "1"
  );
}

-----------------------------

let AnalyticsClass: any = null;
let scarfClient: any = null;


async function loadAnalytics() {
 
  if (typeof window !== "undefined") return null;

  if (!AnalyticsClass) {
    try {
 
      const mod = await import("@segment/analytics-node");
      AnalyticsClass = mod.Analytics;
    } catch (err) {
      console.warn("Failed to load @segment/analytics-node:", err);
      AnalyticsClass = null;
    }
  }

  return AnalyticsClass;
}


async function loadScarfClient() {
  if (typeof window !== "undefined") return null;

  if (!scarfClient) {
    try {
      scarfClient = (await import("./scarf-client")).default;
    } catch (err) {
      console.warn("Failed to load scarf-client:", err);
      scarfClient = null;
    }
  }

  return scarfClient;
}

// ------------------------------
// Telemetry Client Class
// ------------------------------

export class TelemetryClient {
  segment: any | undefined;
  globalProperties: Record<string, any> = {};
  cloudConfiguration: { publicApiKey: string; baseUrl: string } | null = null;
  packageName: string;
  packageVersion: string;

  private telemetryDisabled: boolean = false;
  private sampleRate: number = 0.05;
  private anonymousId = `anon_${uuidv4()}`;

  constructor({
    packageName,
    packageVersion,
    telemetryDisabled,
    sampleRate,
  }: {
    packageName: string;
    packageVersion: string;
    telemetryDisabled?: boolean;
    sampleRate?: number;
  }) {
    this.packageName = packageName;
    this.packageVersion = packageVersion;
    this.telemetryDisabled = telemetryDisabled || isTelemetryDisabled();

    if (this.telemetryDisabled) return;

    this.setSampleRate(sampleRate);

   
    this.initAnalytics().catch(console.error);

    this.setGlobalProperties({
      "copilotkit.package.name": packageName,
      "copilotkit.package.version": packageVersion,
    });
  }

 
  private async initAnalytics() {
    const Analytics = await loadAnalytics();
    if (!Analytics) return;

    const writeKey =
      process.env.COPILOTKIT_SEGMENT_WRITE_KEY ||
      "n7XAZtQCGS2v1vvBy3LgBCv2h3Y8whja";

    try {
      this.segment = new Analytics({ writeKey });
    } catch (e) {
      this.segment = undefined;
    }
  }

  private shouldSendEvent() {
    return Math.random() < this.sampleRate;
  }

  async capture<K extends keyof AnalyticsEvents>(
    event: K,
    properties: AnalyticsEvents[K],
  ) {
    if (this.telemetryDisabled || !this.shouldSendEvent()) return;

    
    if (!this.segment) {
        await this.initAnalytics();
    }
    
    if (!this.segment) return;

    const flattened = flattenObject(properties);

    const merged = {
      ...this.globalProperties,
      ...flattened,
    };

    const ordered = Object.keys(merged)
      .sort()
      .reduce((obj, key) => {
        obj[key] = merged[key];
        return obj;
      }, {} as Record<string, any>);

    try {
      this.segment.track({
        anonymousId: this.anonymousId,
        event,
        properties: ordered,
      });

    
      const client = await loadScarfClient();
      if (client && typeof client.logEvent === 'function') {
        client.logEvent({ event });
      }
    } catch (e) {
       
    }
  }

  setGlobalProperties(properties: Record<string, any>) {
    this.globalProperties = {
      ...this.globalProperties,
      ...flattenObject(properties),
    };
  }

  setCloudConfiguration(properties: { publicApiKey: string; baseUrl: string }) {
    this.cloudConfiguration = properties;
    this.setGlobalProperties({
      cloud: {
        publicApiKey: properties.publicApiKey,
        baseUrl: properties.baseUrl,
      },
    });
  }

  private setSampleRate(sampleRate: number | undefined) {
    let rate = sampleRate ?? 0.05;

    if (process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE) {
      rate = parseFloat(process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE);
    }

    if (isNaN(rate) || rate < 0 || rate > 1) {
      rate = 0.05; // Default safe rate
    }

    this.sampleRate = rate;
    this.setGlobalProperties({
      sampleRate: this.sampleRate,
      sampleWeight: 1 / this.sampleRate,
    });
  }
}

import { Analytics } from "@segment/analytics-node";
import { PostHog } from "posthog-node";
import { AnalyticsEvents } from "./events.js";
import Conf from "conf";

export class AnalyticsService {
  private segment: Analytics | undefined;
  private posthog: PostHog | undefined;
  private globalProperties: Record<string, any> = {};
  private userId: string | undefined;
  private email: string | undefined;
  private organizationId: string | undefined;
  private config = new Conf({ projectName: "CopilotKitCLI" });

  constructor(
    private readonly authData?: {
      userId: string;
      email: string;
      organizationId: string;
    },
  ) {
    if (process.env.SEGMENT_DISABLED === "true") {
      return;
    }

    const segmentWriteKey =
      process.env.SEGMENT_WRITE_KEY || "9Pv6QyExYef2P4hPz4gks6QAvNMi2AOf";

    this.globalProperties = {
      service: "cli",
    };

    if (this.authData?.userId) {
      this.userId = this.authData.userId;
    }

    if (this.authData?.email) {
      this.email = this.authData.email;
      this.globalProperties.email = this.authData.email;
    }

    if (this.authData?.organizationId) {
      this.organizationId = this.authData.organizationId;
    }

    this.segment = new Analytics({
      writeKey: segmentWriteKey,
      disable: process.env.SEGMENT_DISABLE === "true",
    });

    // Initialize PostHog for feature flags
    if (process.env.POSTHOG_DISABLED !== "true") {
      const posthogKey =
        process.env.POSTHOG_KEY ||
        "phc_XZdymVYjrph9Mi0xZYGNyCKexxgblXRR1jMENCtdz5Q"; // Default key
      const posthogHost =
        process.env.POSTHOG_HOST || "https://eu.i.posthog.com";

      this.posthog = new PostHog(posthogKey, {
        host: posthogHost,
      });
    }

    const config = new Conf({ projectName: "CopilotKitCLI" });
    if (!config.get("anonymousId")) {
      config.set("anonymousId", crypto.randomUUID());
    }
  }

  private getAnonymousId(): string {
    const anonymousId = this.config.get("anonymousId");
    if (!anonymousId) {
      const anonymousId = crypto.randomUUID();
      this.config.set("anonymousId", anonymousId);
      return anonymousId;
    }

    return anonymousId as string;
  }

  public track<K extends keyof AnalyticsEvents>(
    event: Omit<Parameters<Analytics["track"]>[0], "userId"> & {
      event: K;
      properties: AnalyticsEvents[K];
    },
  ): Promise<void> {
    if (!this.segment) {
      return Promise.resolve();
    }

    const payload = {
      userId: this.userId ? this.userId : undefined,
      email: this.email ? this.email : undefined,
      anonymousId: this.getAnonymousId(),
      event: event.event,
      properties: {
        ...this.globalProperties,
        ...event.properties,
        $groups: this.organizationId
          ? {
              segment_group: this.organizationId,
            }
          : undefined,
        eventProperties: {
          ...event.properties,
          ...this.globalProperties,
        },
      },
    };

    return new Promise((resolve, reject) => {
      this.segment!.track(payload, (err) => {
        if (err) {
          // Resolve anyway
          resolve();
        }

        resolve();
      });
    });
  }

  /**
   * Check if a feature flag is enabled
   */
  public async isFeatureEnabled(flagKey: string): Promise<boolean> {
    if (!this.posthog) {
      return false;
    }

    try {
      // Use authenticated user ID if available, otherwise use anonymous ID
      const distinctId = this.userId || this.getAnonymousId();
      const flag = await this.posthog.isFeatureEnabled(flagKey, distinctId);
      return Boolean(flag);
    } catch (error) {
      // If there's an error checking the flag, return false (flag disabled)
      console.warn(`Failed to check feature flag ${flagKey}:`, error);
      return false;
    }
  }

  /**
   * Get feature flag payload
   */
  public async getFeatureFlagPayload(flagKey: string): Promise<any> {
    if (!this.posthog) {
      return null;
    }

    try {
      // Use authenticated user ID if available, otherwise use anonymous ID
      const distinctId = this.userId || this.getAnonymousId();
      const payload = await this.posthog.getFeatureFlagPayload(
        flagKey,
        distinctId,
      );
      return payload;
    } catch (error) {
      // If there's an error getting the payload, return null
      console.warn(`Failed to get feature flag payload ${flagKey}:`, error);
      return null;
    }
  }

  /**
   * Shutdown analytics services
   */
  public async shutdown(): Promise<void> {
    if (this.posthog) {
      await this.posthog.shutdown();
    }
  }
}

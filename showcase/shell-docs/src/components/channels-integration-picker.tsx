import { LandingIntegrationPicker } from "./landing-integration-picker";
import { FRONTEND_OPTIONS, isChannelFrontend } from "@/lib/frontend-options";
import { landingIntegrations } from "@/lib/landing-integrations";

/**
 * The home-page stack picker limited to channel surfaces. A reader picks
 * Slack or Teams, then the agent framework they already run, and lands on
 * that framework's channel guide.
 */
export function ChannelsIntegrationPicker() {
  return (
    <div className="not-prose">
      <LandingIntegrationPicker
        frontends={FRONTEND_OPTIONS.filter((option) =>
          isChannelFrontend(option.id),
        ).map((option) => ({
          id: option.id,
          name: option.name,
          summary: option.summary,
          logo: { kind: "frontend" as const, icon: option.icon },
        }))}
        integrations={landingIntegrations()}
        defaultFrontend="slack"
        frontendLegend="Your channel"
      />
    </div>
  );
}

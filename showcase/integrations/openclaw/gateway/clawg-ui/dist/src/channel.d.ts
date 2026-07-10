import type { ChannelPlugin } from "openclaw/plugin-sdk";
type ResolvedAguiAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
};
export declare const aguiChannelPlugin: ChannelPlugin<ResolvedAguiAccount>;
export {};

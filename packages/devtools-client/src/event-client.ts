import { EventClient } from "@tanstack/devtools-event-client";
import type { CopilotKitDevtoolsEvents } from "./types.js";

/**
 * Strips the "copilotkit:" prefix from all keys in CopilotKitDevtoolsEvents,
 * because EventClient adds the pluginId prefix automatically via emit/on.
 */
type StripPrefix<TMap, TPrefix extends string> = {
  [K in keyof TMap & string as K extends `${TPrefix}${infer Suffix}`
    ? Suffix
    : never]: TMap[K];
};

type CopilotKitEventSuffixes = StripPrefix<CopilotKitDevtoolsEvents, "copilotkit:">;

class CopilotKitEventClient extends EventClient<CopilotKitEventSuffixes> {
  constructor() {
    super({
      pluginId: "copilotkit",
      debug: false,
    });
  }
}

export const devtoolsClient = new CopilotKitEventClient();

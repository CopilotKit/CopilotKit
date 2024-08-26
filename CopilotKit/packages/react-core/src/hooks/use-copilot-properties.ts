import { useEffect } from "react";
import { useCopilotContext } from "../context";

export function useCopilotProperties(properties: Record<string, any>) {
  const { copilotApiConfig } = useCopilotContext();

  useEffect(() => {
    // Set the new properties
    copilotApiConfig.properties = {
      ...(copilotApiConfig.properties ?? {}),
      ...properties,
    };

    return () => {
      // Remove only the properties that were set
      Object.keys(properties).forEach((key) => {
        delete (copilotApiConfig.properties ?? {})[key];
      });
    };
  }, [JSON.stringify(properties)]);
}

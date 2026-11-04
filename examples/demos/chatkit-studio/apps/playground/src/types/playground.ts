export interface PlaygroundConfig {
  // Agent configuration
  agentConfig: {
    agUiUrl: string;
    agentName: string;
  };

  // Text customization
  labels: {
    title: string;
    initial: string;
    placeholder: string;
  };

  // Color scheme
  colorScheme: "light" | "dark";

  // Color scheme (CSS variables)
  colors: {
    primary: string;
    contrast: string;
    background: string;
    inputBackground: string;
    secondary: string;
    secondaryContrast: string;
    separator: string;
    muted: string;
  };

  // Typography
  typography: {
    fontFamily: string;
    fontSize: string;
  };

  // Style properties
  style: {
    borderRadius: string;
    padding: string;
    bubbleBorderRadius: string;
  };
}

export const COLOR_SCHEMES = {
  light: {
    primary: "#6366f1",
    contrast: "#ffffff",
    background: "#ffffff",
    inputBackground: "#ffffff",
    secondary: "#f3f4f6",
    secondaryContrast: "#1f2937",
    separator: "#e5e7eb",
    muted: "#9ca3af",
  },
  dark: {
    primary: "#818cf8",
    contrast: "#ffffff",
    background: "#1f2937",
    inputBackground: "#1f2937",
    secondary: "#374151",
    secondaryContrast: "#f9fafb",
    separator: "#4b5563",
    muted: "#9ca3af",
  },
};

export const DEFAULT_CONFIG: PlaygroundConfig = {
  agentConfig: {
    agUiUrl: "http://localhost:8124",
    agentName: "sample_agent",
  },
  labels: {
    title: "My Assistant",
    initial: "Hi! How can I help you today?",
    placeholder: "Type your message...",
  },
  colorScheme: "light",
  colors: COLOR_SCHEMES.light,
  typography: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: "14px",
  },
  style: {
    borderRadius: "8px",
    padding: "16px",
    bubbleBorderRadius: "8px",
  },
};

/**
 * Console styling utilities for CopilotKit branded messages
 * Provides consistent, readable colors across light and dark console themes
 */

/**
 * Color palette optimized for console readability
 */
export const ConsoleColors = {
  /** Primary brand blue - for titles and links */
  primary: "#007acc",
  /** Success green - for positive messaging */
  success: "#22c55e",
  /** Purple - for feature highlights */
  feature: "#a855f7",
  /** Red - for calls-to-action */
  cta: "#ef4444",
  /** Cyan - for closing statements */
  info: "#06b6d4",
  /** Inherit console default - for body text */
  inherit: "inherit",
  /** Warning style */
  warning: "#f59e0b",
} as const;

/**
 * Console style templates for common patterns
 */
export const ConsoleStyles = {
  /** Large header style */
  header: `color: ${ConsoleColors.warning}; font-weight: bold; font-size: 16px;`,
  /** Section header style */
  section: `color: ${ConsoleColors.success}; font-weight: bold;`,
  /** Feature highlight style */
  highlight: `color: ${ConsoleColors.feature}; font-weight: bold;`,
  /** Call-to-action style */
  cta: `color: ${ConsoleColors.success}; font-weight: bold;`,
  /** Info style */
  info: `color: ${ConsoleColors.info}; font-weight: bold;`,
  /** Link style */
  link: `color: ${ConsoleColors.primary}; text-decoration: underline;`,
  /** Body text - inherits console theme */
  body: `color: ${ConsoleColors.inherit};`,
  /** Warning style */
  warning: `color: ${ConsoleColors.cta}; font-weight: bold;`,
} as const;

/**
 * Styled console message for CopilotKit Platform promotion
 * Displays a beautiful, branded advertisement in the console
 */
export function logCopilotKitPlatformMessage() {
  console.log(
    `%cCopilotKit Warning%c

useCopilotChatHeadless_c provides full compatibility with CopilotKit's newly released Headless UI feature set. To enable this premium feature, add your public license key, available for free at:

%chttps://cloud.copilotkit.ai%c

Alternatively, useCopilotChat is available for basic programmatic control, and does not require an API key.

To learn more about premium features, read the documentation here:

%chttps://docs.copilotkit.ai/premium%c`,
    ConsoleStyles.header,
    ConsoleStyles.body,
    ConsoleStyles.cta,
    ConsoleStyles.body,
    ConsoleStyles.link,
    ConsoleStyles.body,
  );
}

export function publicApiKeyRequired(feature: string) {
  console.log(
    `
%cCopilotKit Warning%c \n
In order to use ${feature}, you need to add your CopilotKit API key, available for free at https://cloud.copilotkit.ai.
    `.trim(),
    ConsoleStyles.header,
    ConsoleStyles.body,
  );
}

/**
 * Create a styled console message with custom content
 *
 * @param template - Template string with %c placeholders
 * @param styles - Array of style strings matching the %c placeholders
 *
 * @example
 * ```typescript
 * logStyled(
 *   '%cCopilotKit%c Welcome to the platform!',
 *   [ConsoleStyles.header, ConsoleStyles.body]
 * );
 * ```
 */
export function logStyled(template: string, styles: string[]) {
  console.log(template, ...styles);
}

/**
 * Quick styled console methods for common use cases
 */
export const styledConsole = {
  /** Log a success message */
  success: (message: string) => logStyled(`%c✅ ${message}`, [ConsoleStyles.section]),

  /** Log an info message */
  info: (message: string) => logStyled(`%cℹ️ ${message}`, [ConsoleStyles.info]),

  /** Log a feature highlight */
  feature: (message: string) => logStyled(`%c✨ ${message}`, [ConsoleStyles.highlight]),

  /** Log a call-to-action */
  cta: (message: string) => logStyled(`%c🚀 ${message}`, [ConsoleStyles.cta]),

  /** Log the CopilotKit platform promotion */
  logCopilotKitPlatformMessage: logCopilotKitPlatformMessage,

  /** Log a `publicApiKeyRequired` warning */
  publicApiKeyRequired: publicApiKeyRequired,
} as const;

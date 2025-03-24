/**
 * <br/>
 * A response renderer component for the CopilotKit framework. This component displays
 * a response that may require user feedback, such as approving or rejecting a suggestion.
 * It provides a flexible, customizable interface for rendering responses with user interaction.
 *
 * ## Install Dependencies
 *
 * This component is part of the [@copilotkit/react-ui](https://npmjs.com/package/@copilotkit/react-ui) package.
 *
 * ```shell npm2yarn \"@copilotkit/react-ui"\
 * npm install @copilotkit/react-core @copilotkit/react-ui
 * ```
 *
 * ## Usage
 *
 * ```tsx
 * import { DefaultResponseRenderer } from "@copilotkit/react-ui";
 * import "@copilotkit/react-ui/styles.css";
 *
 * // Basic usage
 * <DefaultResponseRenderer
 *   response={{
 *     id: "response-1",
 *     content: "I've analyzed your data and found these insights..."
 *   }}
 *   status="inProgress"
 *   onRespond={(input) => console.log(`User responded: ${input}`)}
 * />
 * ```
 *
 * ## Customization
 *
 * You can customize the appearance and behavior of the component:
 *
 * ```tsx
 * // Custom labels and styling
 * <DefaultResponseRenderer
 *   response={{
 *     id: "task-123",
 *     content: "Would you like to proceed with this recommendation?"
 *   }}
 *   status="inProgress"
 *   onRespond={handleResponse}
 *   labels={{
 *     responseLabel: "AI Recommendation",
 *     approveLabel: "Yes, proceed",
 *     rejectLabel: "No, cancel",
 *     approvedMessage: "Proceeding with recommendation",
 *     rejectedMessage: "Recommendation cancelled"
 *   }}
 *   className="my-custom-response"
 *   contentClassName="my-custom-content"
 *   buttonClassName="my-custom-button"
 * />
 *
 * // Custom components
 * <DefaultResponseRenderer
 *   response={{
 *     id: "task-456",
 *     content: "# Important Decision\nThis requires your approval"
 *   }}
 *   status="inProgress"
 *   onRespond={handleResponse}
 *   ContentRenderer={({ content, className }) => (
 *     <MyMarkdownRenderer content={content} className={className} />
 *   )}
 *   FeedbackButton={({ label, onClick, className }) => (
 *     <MyCustomButton label={label} onClick={onClick} className={className} />
 *   )}
 * />
 * ```
 *
 * ### Look & Feel
 *
 * By default, CopilotKit components do not have any styles. You can import CopilotKit's stylesheet at the root of your project:
 * ```tsx title="YourRootComponent.tsx"
 * ...
 * import "@copilotkit/react-ui/styles.css"; // [!code highlight]
 *
 * export function YourRootComponent() {
 *   return (
 *     <CopilotKit>
 *       ...
 *     </CopilotKit>
 *   );
 * }
 * ```
 * For more information about how to customize the styles, check out the [Customize Look & Feel](/guides/custom-look-and-feel/customize-built-in-ui-components) guide.
 */

import React, { useState } from "react";
import {
  Response,
  ResponseRendererProps,
  ContentRendererProps,
  FeedbackButtonProps,
  CompletedFeedbackProps,
  ResponseRendererIconProps,
} from "./types";

/**
 * Creates a cache for storing response feedback
 */
const createResponseCache = <T extends { id: string }>() => {
  const responseCache = new Map<string, T>();

  return {
    getResponse: (id: string) => responseCache.get(id),
    setResponse: (id: string, response: T) => responseCache.set(id, response),
  };
};

/**
 * Default global response cache instance
 */
const useResponseCache = createResponseCache<Response & { __feedback__?: string }>();

/**
 * Default expand icon component
 */
const DefaultExpandIcon: React.FC<ResponseRendererIconProps> = ({ className }) => (
  <svg
    className={className}
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>
);

/**
 * Default collapse icon component
 */
const DefaultCollapseIcon: React.FC<ResponseRendererIconProps> = ({ className }) => (
  <svg
    className={className}
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="18 15 12 9 6 15"></polyline>
  </svg>
);

/**
 * Default content renderer that simply displays text
 */
const DefaultContentRenderer: React.FC<ContentRendererProps> = ({ content, className }) => (
  <div className={className}>{content}</div>
);

/**
 * Default feedback button component
 */
const DefaultFeedbackButton: React.FC<FeedbackButtonProps> = ({ label, onClick, className }) => (
  <button onClick={onClick} className={className}>
    {label}
  </button>
);

/**
 * Default completed feedback component
 */
const DefaultCompletedFeedback: React.FC<CompletedFeedbackProps> = ({ message, className }) => (
  <div className={className}>
    <span>{message}</span>
  </div>
);

/**
 * Default response renderer component that handles rendering responses
 * and collecting user feedback
 */
export const DefaultResponseRenderer: React.FC<ResponseRendererProps> = ({
  response,
  status,
  onRespond,
  icons,
  labels,
  ContentRenderer = DefaultContentRenderer,
  FeedbackButton = DefaultFeedbackButton,
  CompletedFeedback = DefaultCompletedFeedback,
  className = "copilotkit-response",
  contentClassName = "copilotkit-response-content",
  actionsClassName = "copilotkit-response-actions",
  buttonClassName = "copilotkit-response-button",
  completedFeedbackClassName = "copilotkit-response-completed-feedback",
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  // Default label values
  const defaultLabels = {
    responseLabel: "Response",
    approveLabel: "Approve",
    rejectLabel: "Reject",
    approvedMessage: "Approved",
    rejectedMessage: "Rejected",
    feedbackSubmittedMessage: "Feedback submitted",
  };

  // Merge provided labels with defaults
  const mergedLabels = { ...defaultLabels, ...labels };

  // Function to render feedback UI based on status
  const renderFeedback = () => {
    if (status === "complete") {
      const cachedResponse = useResponseCache.getResponse(response.id);
      return (
        <CompletedFeedback
          message={
            cachedResponse?.__feedback__
              ? cachedResponse.__feedback__ === mergedLabels.approvedMessage
                ? mergedLabels.approvedMessage
                : mergedLabels.rejectedMessage
              : mergedLabels.feedbackSubmittedMessage
          }
          className={completedFeedbackClassName}
        />
      );
    }

    if (status === "inProgress" || status === "executing") {
      return (
        <>
          <FeedbackButton
            label={mergedLabels.approveLabel}
            onClick={() => {
              setIsExpanded(false);
              onRespond?.(mergedLabels.approveLabel);
              useResponseCache.setResponse(response.id, {
                ...response,
                __feedback__: mergedLabels.approvedMessage,
              });
            }}
            className={buttonClassName}
          />
          <FeedbackButton
            label={mergedLabels.rejectLabel}
            onClick={() => {
              setIsExpanded(false);
              useResponseCache.setResponse(response.id, {
                ...response,
                __feedback__: mergedLabels.rejectedMessage,
              });
              onRespond?.(mergedLabels.rejectLabel);
            }}
            className={buttonClassName}
          />
        </>
      );
    }

    return null;
  };

  // Decide which icon to display
  const ExpandIcon = icons?.expand || DefaultExpandIcon;
  const CollapseIcon = icons?.collapse || DefaultCollapseIcon;

  return (
    <div className={className}>
      {/* Response content - conditionally expanded */}
      {isExpanded && <ContentRenderer content={response.content} className={contentClassName} />}

      <div className={actionsClassName}>
        <div className="copilotkit-response-label">
          <button onClick={() => setIsExpanded(!isExpanded)} className="copilotkit-toggle-button">
            {isExpanded ? (
              <CollapseIcon className="copilotkit-icon" />
            ) : (
              <ExpandIcon className="copilotkit-icon" />
            )}
          </button>
          <span>{mergedLabels.responseLabel}</span>
        </div>

        <div className="copilotkit-response-buttons">{renderFeedback()}</div>
      </div>
    </div>
  );
};

/**
 * Export the response cache for reuse
 */
export { createResponseCache };

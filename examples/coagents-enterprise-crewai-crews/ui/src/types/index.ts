import { ReactNode } from "react";

/**
 * Status of a response or action that requires user input
 */
export type ResponseStatus = "inProgress" | "complete" | "executing";

/**
 * Response data structure for the ResponseRenderer
 */
export interface Response {
  /**
   * Unique identifier for the response
   */
  id: string;

  /**
   * The content of the response to display
   */
  content: string;

  /**
   * Optional metadata for the response
   */
  metadata?: Record<string, string>;
}

/**
 * Optional cache for storing user feedback
 */
export interface ResponseCache<T extends { id: string }> {
  /**
   * Get feedback for a specific ID
   */
  getResponse: (id: string) => T | undefined;

  /**
   * Set feedback for a specific ID
   */
  setResponse: (id: string, response: T) => void;
}

/**
 * Props for custom icon components
 */
export interface ResponseRendererIconProps {
  className?: string;
}

/**
 * Icons for the ResponseRenderer component
 */
export interface ResponseRendererIcons {
  /**
   * Icon for expanding content
   */
  expand?: React.ComponentType<ResponseRendererIconProps>;

  /**
   * Icon for collapsing content
   */
  collapse?: React.ComponentType<ResponseRendererIconProps>;
}

/**
 * Labels for the ResponseRenderer component
 */
export interface ResponseRendererLabels {
  /**
   * Label for the response section
   */
  responseLabel?: string;

  /**
   * Label for the approve button
   */
  approveLabel?: string;

  /**
   * Label for the reject button
   */
  rejectLabel?: string;

  /**
   * Message shown when approved
   */
  approvedMessage?: string;

  /**
   * Message shown when rejected
   */
  rejectedMessage?: string;

  /**
   * Message shown when feedback is submitted
   */
  feedbackSubmittedMessage?: string;
}

/**
 * Props for the content renderer component
 */
export interface ContentRendererProps {
  /**
   * Content to render
   */
  content: string;

  /**
   * CSS class name for styling
   */
  className?: string;
}

/**
 * Props for the feedback button component
 */
export interface FeedbackButtonProps {
  /**
   * The text to display on the button
   */
  label: string;

  /**
   * Function to call when the button is clicked
   */
  onClick: () => void;

  /**
   * CSS class name for styling
   */
  className?: string;
}

/**
 * Props for the completed feedback display component
 */
export interface CompletedFeedbackProps {
  /**
   * The message to display
   */
  message: string;

  /**
   * CSS class name for styling
   */
  className?: string;
}

/**
 * Props for the ResponseRenderer component
 */
export interface ResponseRendererProps {
  /**
   * The response data to render
   */
  response: Response;

  /**
   * The current status of the response
   */
  status: ResponseStatus;

  /**
   * Function to call when a response is given
   */
  onRespond?: (input: string) => void;

  /**
   * Custom icons for the component
   */
  icons?: ResponseRendererIcons;

  /**
   * Custom labels for the component
   */
  labels?: ResponseRendererLabels;

  /**
   * Custom component for rendering content
   */
  ContentRenderer?: React.ComponentType<ContentRendererProps>;

  /**
   * Custom component for rendering feedback buttons
   */
  FeedbackButton?: React.ComponentType<FeedbackButtonProps>;

  /**
   * Custom component for rendering completed feedback
   */
  CompletedFeedback?: React.ComponentType<CompletedFeedbackProps>;

  /**
   * CSS class for the root element
   */
  className?: string;

  /**
   * CSS class for the content element
   */
  contentClassName?: string;

  /**
   * CSS class for the actions container
   */
  actionsClassName?: string;

  /**
   * CSS class for feedback buttons
   */
  buttonClassName?: string;

  /**
   * CSS class for completed feedback
   */
  completedFeedbackClassName?: string;

  /**
   * Children nodes
   */
  children?: ReactNode;
}

/**
 * Base state item interface for agent state items
 */
export interface StateItem {
  /**
   * Unique identifier for the item
   */
  id: string;

  /**
   * Timestamp when the item was created
   */
  timestamp: string;
}

/**
 * Tool execution state item
 */
export interface ToolStateItem extends StateItem {
  /**
   * Name of the tool that was executed
   */
  tool: string;

  /**
   * Optional thought process for the tool execution
   */
  thought?: string;

  /**
   * Result of the tool execution
   */
  result?: unknown;
}

/**
 * Task state item
 */
export interface TaskStateItem extends StateItem {
  /**
   * Name of the task
   */
  name: string;

  /**
   * Description of the task
   */
  description?: string;
}

/**
 * AgentState containing information about steps and tasks
 */
export interface AgentState {
  /**
   * Array of tool execution steps
   */
  steps?: ToolStateItem[];

  /**
   * Array of tasks
   */
  tasks?: TaskStateItem[];
}

/**
 * Props for the item renderer component
 */
export interface StateItemRendererProps {
  /**
   * The item to render
   */
  item: ToolStateItem | TaskStateItem;

  /**
   * Whether the item is the newest
   */
  isNewest: boolean;

  /**
   * CSS class for the item container
   */
  className?: string;
}

/**
 * Props for the skeleton loader component
 */
export interface SkeletonLoaderProps {
  /**
   * CSS class for the skeleton
   */
  className?: string;
}

/**
 * Props for the DefaultStateRenderer component
 */
export interface StateRendererProps {
  /**
   * The state to render
   */
  state?: AgentState;

  /**
   * The current status
   */
  status: ResponseStatus;

  /**
   * Custom component for rendering individual state items
   */
  StateItemRenderer?: React.ComponentType<StateItemRendererProps>;

  /**
   * Custom component for showing a loading skeleton
   */
  SkeletonLoader?: React.ComponentType<SkeletonLoaderProps>;

  /**
   * Custom labels for the component
   */
  labels?: {
    /**
     * Label shown when in progress
     */
    inProgressLabel?: string;

    /**
     * Label shown when complete
     */
    completeLabel?: string;

    /**
     * Label shown when no items are present
     */
    emptyLabel?: string;
  };

  /**
   * Custom icons for the component
   */
  icons?: ResponseRendererIcons;

  /**
   * CSS class for the root element
   */
  className?: string;

  /**
   * CSS class for the content container
   */
  contentClassName?: string;

  /**
   * CSS class for state items
   */
  itemClassName?: string;

  /**
   * Maximum height for the content area
   */
  maxHeight?: string;

  /**
   * Initial collapsed state
   */
  defaultCollapsed?: boolean;

  /**
   * Children nodes
   */
  children?: ReactNode;
}

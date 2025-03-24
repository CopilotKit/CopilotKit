import { ReactNode } from "react";

/**
 * Status of a response or action that requires user input
 */
export type CrewsResponseStatus = "inProgress" | "complete" | "executing";

/**
 * Response data structure for the ResponseRenderer
 */
export interface CrewsResponse {
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
  metadata?: Record<string, any>;
}

/**
 * Optional cache for storing user feedback
 */
export interface CrewsResponseCache<T extends { id: string }> {
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
export interface CrewsResponseRendererIconProps {
  className?: string;
}

/**
 * Icons for the ResponseRenderer component
 */
export interface CrewsResponseRendererIcons {
  /**
   * Icon for expanding content
   */
  expand?: React.ComponentType<CrewsResponseRendererIconProps>;

  /**
   * Icon for collapsing content
   */
  collapse?: React.ComponentType<CrewsResponseRendererIconProps>;
}

/**
 * Labels for the ResponseRenderer component
 */
export interface CrewsResponseRendererLabels {
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
export interface CrewsContentRendererProps {
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
export interface CrewsFeedbackButtonProps {
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
export interface CrewsCompletedFeedbackProps {
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
export interface CrewsResponseRendererProps {
  /**
   * The response data to render
   */
  response: Response;

  /**
   * The current status of the response
   */
  status: CrewsResponseStatus;

  /**
   * Function to call when a response is given
   */
  onRespond?: (input: string) => void;

  /**
   * Custom icons for the component
   */
  icons?: CrewsResponseRendererIcons;

  /**
   * Custom labels for the component
   */
  labels?: CrewsResponseRendererLabels;

  /**
   * Custom component for rendering content
   */
  ContentRenderer?: React.ComponentType<CrewsContentRendererProps>;

  /**
   * Custom component for rendering feedback buttons
   */
  FeedbackButton?: React.ComponentType<CrewsFeedbackButtonProps>;

  /**
   * Custom component for rendering completed feedback
   */
  CompletedFeedback?: React.ComponentType<CrewsCompletedFeedbackProps>;

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
export interface CrewsStateItem {
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
export interface CrewsToolStateItem extends CrewsStateItem {
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
  result?: any;
}

/**
 * Task state item
 */
export interface CrewsTaskStateItem extends CrewsStateItem {
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
export interface CrewsAgentState {
  /**
   * Array of tool execution steps
   */
  steps?: CrewsToolStateItem[];

  /**
   * Array of tasks
   */
  tasks?: CrewsTaskStateItem[];
}

/**
 * Props for the item renderer component
 */
export interface CrewsStateItemRendererProps {
  /**
   * The item to render
   */
  item: CrewsToolStateItem | CrewsTaskStateItem;

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
export interface CrewsSkeletonLoaderProps {
  /**
   * CSS class for the skeleton
   */
  className?: string;
}

/**
 * Props for the DefaultStateRenderer component
 */
export interface CrewsStateRendererProps {
  /**
   * The state to render
   */
  state?: CrewsAgentState;

  /**
   * The current status
   */
  status: CrewsResponseStatus;

  /**
   * Custom component for rendering individual state items
   */
  StateItemRenderer?: React.ComponentType<CrewsStateItemRendererProps>;

  /**
   * Custom component for showing a loading skeleton
   */
  SkeletonLoader?: React.ComponentType<CrewsSkeletonLoaderProps>;

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
  icons?: CrewsResponseRendererIcons;

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

import React, { type ReactNode } from "react";
import { CopilotChat, type CopilotChatProps } from "./CopilotChat";

export interface CopilotModalProps extends CopilotChatProps {
  /**
   * Optional children rendered inside the modal context.
   */
  children?: ReactNode;
}

/**
 * Headless CopilotModal component for React Native.
 *
 * A thin wrapper around CopilotChat that mirrors the web SDK's CopilotModal
 * API surface. On React Native, modal presentation is handled by the consumer
 * (e.g. React Native's `Modal` component) -- this component only provides
 * the agent wiring and prop resolution.
 *
 * ```tsx
 * import { CopilotModal } from "@copilotkit/react-native";
 * import { Modal } from "react-native";
 *
 * <Modal visible={isOpen}>
 *   <CopilotModal agentId="my-agent">
 *     <MyChatUI />
 *   </CopilotModal>
 * </Modal>
 * ```
 */
export function CopilotModal({ children, ...props }: CopilotModalProps) {
  return <CopilotChat {...props}>{children}</CopilotChat>;
}

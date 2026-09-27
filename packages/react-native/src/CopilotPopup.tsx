// NOTE: This component needs to be exported from index.ts
// e.g. export { CopilotPopup } from "./CopilotPopup";
//      export type { CopilotPopupProps, CopilotPopupHandle } from "./CopilotPopup";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import type { ViewStyle } from "react-native";
import { CopilotChat } from "./CopilotChat";
import { radius, useCopilotTheme } from "./components/theme";
import type { NativeAttachmentsConfig } from "./hooks/use-attachments";
import type { CopilotKitCoreErrorCode } from "@copilotkit/core";

export interface CopilotPopupProps {
  /**
   * The agent ID to use for this chat session.
   * Passed through to CopilotChat.
   */
  agentId?: string;

  /**
   * @deprecated Use `agentId` instead.
   */
  agentName?: string;

  /**
   * Thread ID for this chat session.
   */
  threadId?: string;

  /**
   * Throttle interval (ms) for re-renders.
   */
  throttleMs?: number;

  /**
   * Whether the popup starts in the open state.
   * @default false
   */
  defaultOpen?: boolean;

  /**
   * Height of the popup card. Accepts a number (points) or a percentage
   * string (e.g. "60%") relative to the screen height.
   * @default "60%"
   */
  height?: number | string;

  /**
   * Error handler scoped to this popup's chat agent.
   */
  onError?: (error: Error) => void;

  /**
   * Title displayed in the popup header bar.
   * @default "CopilotKit"
   */
  headerTitle?: string;

  /**
   * Enable multimodal file attachments. Forwarded to the internal CopilotChat.
   * Children access attachment state via `useCopilotChatContext()`.
   */
  attachments?: NativeAttachmentsConfig;

  /**
   * Optional children rendered below the CopilotChat content
   * inside the popup card.
   */
  children?: ReactNode;

  /**
   * Callback fired when the popup opens.
   */
  onOpen?: () => void;

  /**
   * Callback fired when the popup closes.
   */
  onClose?: () => void;

  /**
   * Whether tapping the semi-transparent backdrop dismisses the popup.
   * Equivalent to web SDK's `clickOutsideToClose`.
   * @default true
   */
  dismissOnBackdropPress?: boolean;

  /**
   * Whether to show the floating action button (FAB) that toggles the popup.
   * @default true
   */
  showToggleButton?: boolean;

  /**
   * Custom styles applied to the popup card container.
   */
  style?: ViewStyle;
}

/**
 * Imperative handle exposed via ref for controlling the popup programmatically.
 */
export interface CopilotPopupHandle {
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/**
 * CopilotPopup for React Native.
 *
 * A floating action button (FAB) that opens a modal chat overlay.
 * The popup appears as a card floating above content with rounded corners,
 * a shadow, and a semi-transparent backdrop.
 *
 * ```tsx
 * import { CopilotPopup } from "@copilotkit/react-native";
 *
 * const popupRef = useRef<CopilotPopupHandle>(null);
 *
 * <CopilotPopup
 *   ref={popupRef}
 *   agentId="my-agent"
 *   headerTitle="Chat"
 *   defaultOpen={false}
 * />
 * ```
 */
export const CopilotPopup = forwardRef<CopilotPopupHandle, CopilotPopupProps>(
  function CopilotPopup(
    {
      agentId,
      agentName,
      threadId,
      throttleMs,
      defaultOpen = false,
      height = "60%",
      onError,
      headerTitle = "CopilotKit",
      attachments: attachmentsConfig,
      children,
      onOpen,
      onClose,
      dismissOnBackdropPress = true,
      showToggleButton = true,
      style,
    }: CopilotPopupProps,
    ref: React.Ref<CopilotPopupHandle>,
  ) {
    const [visible, setVisible] = useState(defaultOpen);
    const { height: screenHeight } = useWindowDimensions();
    const theme = useCopilotTheme();

    // Stable refs for callbacks to avoid effect churn
    const onOpenRef = useRef(onOpen);
    const onCloseRef = useRef(onClose);
    useEffect(() => {
      onOpenRef.current = onOpen;
    }, [onOpen]);
    useEffect(() => {
      onCloseRef.current = onClose;
    }, [onClose]);

    const handleOpen = useCallback(() => {
      setVisible(true);
      onOpenRef.current?.();
    }, []);

    const handleClose = useCallback(() => {
      setVisible(false);
      onCloseRef.current?.();
    }, []);

    const handleToggle = useCallback(() => {
      setVisible((prev) => {
        const next = !prev;
        if (next) {
          onOpenRef.current?.();
        } else {
          onCloseRef.current?.();
        }
        return next;
      });
    }, []);

    // Expose imperative methods
    useImperativeHandle(
      ref,
      () => ({
        open: handleOpen,
        close: handleClose,
        toggle: handleToggle,
      }),
      [handleOpen, handleClose, handleToggle],
    );

    // Resolve popup height
    const resolvedHeight =
      typeof height === "string" && height.endsWith("%")
        ? (parseFloat(height) / 100) * screenHeight
        : typeof height === "number"
          ? height
          : 0.6 * screenHeight;

    // Wrap onError to match CopilotChat's expected signature
    const chatOnError = onError
      ? (event: {
          error: Error;
          code: CopilotKitCoreErrorCode;
          context: Record<string, any>;
        }) => onError(event.error)
      : undefined;

    return (
      <>
        {/* Floating Action Button */}
        {showToggleButton && !visible && (
          <TouchableOpacity
            testID="copilot-popup-fab"
            style={[styles.fab, { backgroundColor: theme.primary }]}
            onPress={handleToggle}
            activeOpacity={0.8}
            accessibilityLabel="Open chat"
            accessibilityRole="button"
          >
            <Text style={styles.fabIcon}>💬</Text>
          </TouchableOpacity>
        )}

        {/* Modal Overlay */}
        <Modal
          testID="copilot-popup-modal"
          visible={visible}
          transparent
          animationType="slide"
          onRequestClose={handleClose}
        >
          {/* Backdrop */}
          <Pressable
            testID="copilot-popup-backdrop"
            style={styles.backdrop}
            onPress={dismissOnBackdropPress ? handleClose : undefined}
          >
            {/* Card — stop propagation so tapping the card doesn't dismiss */}
            <Pressable
              testID="copilot-popup-card"
              style={[
                styles.card,
                { height: resolvedHeight, backgroundColor: theme.background },
                style,
              ]}
              onPress={() => {
                // Prevent backdrop press from firing
              }}
            >
              {/* Header: title centered between a spacer and the close button */}
              <View
                style={[styles.header, { borderBottomColor: theme.border }]}
              >
                <View style={styles.headerSide} />
                <Text
                  numberOfLines={1}
                  style={[styles.headerTitle, { color: theme.foreground }]}
                >
                  {headerTitle}
                </Text>
                <TouchableOpacity
                  testID="copilot-popup-close"
                  style={styles.closeButton}
                  onPress={handleClose}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Close chat"
                  accessibilityRole="button"
                >
                  <Text
                    style={[styles.closeIcon, { color: theme.mutedForeground }]}
                  >
                    ✕
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Chat Content */}
              <View style={styles.chatContainer}>
                <CopilotChat
                  agentId={agentId}
                  agentName={agentName}
                  threadId={threadId}
                  throttleMs={throttleMs}
                  onError={chatOnError}
                  attachments={attachmentsConfig}
                >
                  {children}
                </CopilotChat>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </>
    );
  },
);

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  fabIcon: {
    fontSize: 24,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "flex-end",
  },
  card: {
    borderTopLeftRadius: radius["2xl"],
    borderTopRightRadius: radius["2xl"],
    overflow: "hidden",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
  },
  header: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: {
    width: 32,
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 15,
    fontWeight: "600",
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  closeIcon: {
    fontSize: 16,
  },
  chatContainer: {
    flex: 1,
  },
});

/**
 * CopilotModal — a bottom-sheet chat overlay for React Native.
 *
 * Mobile equivalent of CopilotPopup on web. Wraps CopilotChat inside
 * @gorhom/bottom-sheet so the chat can slide up over any screen.
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { StyleSheet, View } from "react-native";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { CopilotChat } from "./CopilotChat";
import type { CopilotChatProps } from "./CopilotChat";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CopilotModalProps {
  /** Controlled visibility — when true the sheet opens, when false it closes. */
  visible?: boolean;

  /** Called when the sheet is dismissed (via backdrop tap, swipe-down, or close()). */
  onDismiss?: () => void;

  /**
   * Bottom-sheet snap points.
   * @default ['50%', '90%']
   */
  snapPoints?: (string | number)[];

  /**
   * Which snap-point index to open at.
   * @default 0
   */
  initialSnapIndex?: number;

  /**
   * Whether closing the sheet fires onDismiss.
   * @default true
   */
  enableDismissOnClose?: boolean;

  /**
   * Backdrop opacity when the sheet is open.
   * @default 0.5
   */
  backdropOpacity?: number;

  // -- Pass-through to CopilotChat ------------------------------------------

  /** Which agent to connect to. */
  agentName?: string;

  /** Input placeholder text. */
  placeholder?: string;

  /** Seed messages shown on first render. */
  initialMessages?: string[];

  /** Title shown in the CopilotChat header area. */
  headerTitle?: string;
}

/** Imperative handle exposed via ref. */
export interface CopilotModalRef {
  /** Programmatically open the bottom sheet. */
  open: () => void;
  /** Programmatically close the bottom sheet. */
  close: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CopilotModal = forwardRef<CopilotModalRef, CopilotModalProps>(
  function CopilotModal(
    {
      visible,
      onDismiss,
      snapPoints: snapPointsProp,
      initialSnapIndex = 0,
      enableDismissOnClose = true,
      backdropOpacity = 0.5,
      agentName,
      placeholder,
      initialMessages,
      headerTitle,
    },
    ref,
  ) {
    const bottomSheetRef = useRef<BottomSheet>(null);

    // Stable snap-points array
    const snapPoints = useMemo(
      () => snapPointsProp ?? ["50%", "90%"],
      [snapPointsProp],
    );

    // ── Imperative API ────────────────────────────────────────────────────
    useImperativeHandle(
      ref,
      () => ({
        open() {
          bottomSheetRef.current?.snapToIndex(initialSnapIndex);
        },
        close() {
          bottomSheetRef.current?.close();
        },
      }),
      [initialSnapIndex],
    );

    // ── Controlled visibility ─────────────────────────────────────────────
    useEffect(() => {
      if (visible === undefined) return;
      if (visible) {
        bottomSheetRef.current?.snapToIndex(initialSnapIndex);
      } else {
        bottomSheetRef.current?.close();
      }
    }, [visible, initialSnapIndex]);

    // ── Backdrop renderer ─────────────────────────────────────────────────
    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={backdropOpacity}
          pressBehavior="close"
        />
      ),
      [backdropOpacity],
    );

    // ── Sheet close handler ───────────────────────────────────────────────
    const handleClose = useCallback(() => {
      if (enableDismissOnClose) {
        onDismiss?.();
      }
    }, [enableDismissOnClose, onDismiss]);

    // ── Build CopilotChat props ───────────────────────────────────────────
    const chatProps = useMemo(() => {
      const props: Partial<CopilotChatProps> = {};
      if (agentName !== undefined) props.agentName = agentName;
      if (placeholder !== undefined) props.placeholder = placeholder;
      if (initialMessages !== undefined)
        props.initialMessages = initialMessages;
      if (headerTitle !== undefined) props.headerTitle = headerTitle;
      return props;
    }, [agentName, placeholder, initialMessages, headerTitle]);

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        onClose={handleClose}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.handleIndicator}
      >
        <BottomSheetView style={styles.contentContainer}>
          <CopilotChat
            {...chatProps}
            FlatListComponent={BottomSheetFlatList}
            disableKeyboardAvoiding
          />
        </BottomSheetView>
      </BottomSheet>
    );
  },
);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  handleIndicator: {
    width: 40,
    height: 4,
    backgroundColor: "#DDDDDD",
  },
  contentContainer: {
    flex: 1,
  },
});

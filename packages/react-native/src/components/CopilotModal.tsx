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
  useState,
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
import { radius, useCopilotTheme, withOpacity } from "./theme";

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

  /**
   * Ease the welcome screen in each time the sheet opens. Defaults to `true`.
   * See `CopilotChat`'s `introAnimation`.
   */
  introAnimation?: boolean;
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
      introAnimation = true,
    },
    ref,
  ) {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const theme = useCopilotTheme();
    // The chat stays mounted while the sheet is closed, so its intro is tied
    // to the sheet opening rather than to mounting.
    const [isOpen, setIsOpen] = useState(false);

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

    // ── Open state (set as the sheet starts moving, so the intro plays with it)
    const handleAnimate = useCallback((_fromIndex: number, toIndex: number) => {
      setIsOpen(toIndex >= 0);
    }, []);

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
        onAnimate={handleAnimate}
        onClose={handleClose}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        backgroundStyle={[
          styles.sheetBackground,
          { backgroundColor: theme.background },
        ]}
        handleIndicatorStyle={[
          styles.handleIndicator,
          { backgroundColor: withOpacity(theme.mutedForeground, 0.4) },
        ]}
      >
        <BottomSheetView style={styles.contentContainer}>
          <CopilotChat
            {...chatProps}
            introAnimation={introAnimation && isOpen}
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
    borderTopLeftRadius: radius["2xl"],
    borderTopRightRadius: radius["2xl"],
  },
  handleIndicator: {
    width: 36,
    height: 4,
  },
  contentContainer: {
    flex: 1,
  },
});

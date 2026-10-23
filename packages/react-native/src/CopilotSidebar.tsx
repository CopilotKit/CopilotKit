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
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { ViewStyle } from "react-native";
import { CopilotChat } from "./CopilotChat";
import type { CopilotChatBaseProps } from "./CopilotChat";
import {
  CopilotColorSchemeProvider,
  useCopilotTheme,
} from "./components/theme";
import type { CopilotColorScheme } from "./components/theme";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CopilotSidebarHandle {
  /** Slide the drawer open. */
  open(): void;
  /** Slide the drawer closed. */
  close(): void;
  /** Toggle the drawer open/closed. */
  toggle(): void;
}

export interface CopilotSidebarProps extends Omit<
  CopilotChatBaseProps,
  "children"
> {
  /**
   * Start the drawer in the open position.
   * @default false
   */
  defaultOpen?: boolean;

  /**
   * Width of the drawer panel. Accepts a number (points) or a percentage
   * string (e.g. `"85%"`). Defaults to 85% of the screen width.
   */
  width?: number | string;

  /**
   * Title displayed in the drawer header bar.
   * @default "Copilot"
   */
  headerTitle?: string;

  /**
   * Show a floating action button to toggle the drawer.
   * @default true
   */
  showToggleButton?: boolean;

  /** Called after the drawer finishes opening. */
  onOpen?: () => void;

  /** Called after the drawer finishes closing. */
  onClose?: () => void;

  /** Custom style applied to the drawer container. */
  style?: ViewStyle;

  /**
   * `"light"` (the default), `"dark"`, or `"system"` to follow the device's
   * setting. Applies to the drawer and to CopilotKit components inside it.
   */
  colorScheme?: CopilotColorScheme;

  /** Content rendered inside the drawer below the chat area. */
  children?: ReactNode;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANIMATION_DURATION_MS = 300;
const DEFAULT_HEADER_TITLE = "Copilot";
const BACKDROP_OPACITY = 0.4;
const FAB_SIZE = 56;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CopilotSidebar -- a slide-in drawer from the right edge of the screen
 * that wraps CopilotChat for React Native.
 *
 * ```tsx
 * import { CopilotSidebar } from "@copilotkit/react-native";
 *
 * const ref = useRef<CopilotSidebarHandle>(null);
 *
 * <CopilotSidebar
 *   ref={ref}
 *   agentId="my-agent"
 *   headerTitle="Assistant"
 *   defaultOpen={false}
 * />
 * ```
 */
export const CopilotSidebar = forwardRef<
  CopilotSidebarHandle,
  CopilotSidebarProps
>(function CopilotSidebar(
  {
    agentId,
    agentName,
    threadId,
    onError,
    throttleMs,
    defaultOpen = false,
    width: widthProp,
    headerTitle = DEFAULT_HEADER_TITLE,
    showToggleButton = true,
    onOpen,
    onClose,
    style,
    colorScheme,
    children,
    ...rest
  },
  ref,
) {
  const { width: screenWidth } = useWindowDimensions();
  const theme = useCopilotTheme(colorScheme);

  // Resolve drawer width ---------------------------------------------------
  const drawerWidth = resolveWidth(widthProp, screenWidth);

  // Animation & open state -------------------------------------------------
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const slideAnim = useRef(
    new Animated.Value(defaultOpen ? 0 : drawerWidth),
  ).current;

  // Keep the animated value in sync when drawerWidth changes while closed
  useEffect(() => {
    if (!isOpen) {
      slideAnim.setValue(drawerWidth);
    }
  }, [drawerWidth, isOpen, slideAnim]);

  const animateTo = useCallback(
    (toValue: number, cb?: () => void) => {
      Animated.timing(slideAnim, {
        toValue,
        duration: ANIMATION_DURATION_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) cb?.();
      });
    },
    [slideAnim],
  );

  const open = useCallback(() => {
    setIsOpen(true);
    animateTo(0, onOpen);
  }, [animateTo, onOpen]);

  const close = useCallback(() => {
    animateTo(drawerWidth, () => {
      setIsOpen(false);
      onClose?.();
    });
  }, [animateTo, drawerWidth, onClose]);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }, [isOpen, open, close]);

  useImperativeHandle(ref, () => ({ open, close, toggle }), [
    open,
    close,
    toggle,
  ]);

  // Callbacks stored in refs for stable animation closures -----------------
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <CopilotColorSchemeProvider colorScheme={colorScheme}>
      {/* Backdrop */}
      {isOpen && (
        <Pressable
          style={styles.backdrop}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close sidebar"
          testID="copilot-sidebar-backdrop"
        />
      )}

      {/* Drawer */}
      {isOpen && (
        <Animated.View
          style={[
            styles.drawer,
            {
              width: drawerWidth,
              backgroundColor: theme.background,
              transform: [{ translateX: slideAnim }],
            },
            style,
          ]}
          testID="copilot-sidebar-drawer"
        >
          {/* Header: title centered between a spacer and the close button */}
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <View style={styles.headerSide} />
            <Text
              numberOfLines={1}
              style={[styles.headerTitle, { color: theme.foreground }]}
            >
              {headerTitle}
            </Text>
            <Pressable
              onPress={close}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              testID="copilot-sidebar-close"
            >
              <Text
                style={[styles.closeIcon, { color: theme.mutedForeground }]}
              >
                {"✕"}
              </Text>
            </Pressable>
          </View>

          {/* Chat area */}
          <View style={styles.chatContainer}>
            <CopilotChat
              agentId={agentId}
              agentName={agentName}
              threadId={threadId}
              onError={onError}
              throttleMs={throttleMs}
              {...rest}
            >
              {children}
            </CopilotChat>
          </View>
        </Animated.View>
      )}

      {/* Floating action button */}
      {showToggleButton && !isOpen && (
        <Pressable
          style={[styles.fab, { backgroundColor: theme.primary }]}
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel="Open sidebar"
          testID="copilot-sidebar-fab"
        >
          <Text style={styles.fabIcon}>{"💬"}</Text>
        </Pressable>
      )}
    </CopilotColorSchemeProvider>
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveWidth(
  widthProp: number | string | undefined,
  screenWidth: number,
): number {
  if (widthProp === undefined) {
    return Math.round(screenWidth * 0.85);
  }
  if (typeof widthProp === "number") {
    return widthProp;
  }
  // Percentage string, e.g. "85%"
  const pctMatch = String(widthProp).match(/^(\d+(?:\.\d+)?)%$/);
  if (pctMatch) {
    return Math.round(screenWidth * (parseFloat(pctMatch[1]) / 100));
  }
  // Fallback: try parsing as number
  const parsed = parseFloat(widthProp);
  return isNaN(parsed) ? Math.round(screenWidth * 0.85) : parsed;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: `rgba(0, 0, 0, ${BACKDROP_OPACITY})`,
    zIndex: 999,
  },
  drawer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
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
  fab: {
    position: "absolute",
    bottom: 24,
    right: 24,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
    zIndex: 998,
  },
  fabIcon: {
    fontSize: 24,
  },
});

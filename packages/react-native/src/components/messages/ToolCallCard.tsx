import React from "react";
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { usePulse } from "../motion";
import { MONO_FONT, radius, useCopilotTheme } from "../theme";

const PULSE_CYCLE_MS = 1800;

/**
 * Compact card for a tool call no renderer is registered for: a status icon,
 * the tool's name and its state. The label pulses while the tool runs (held
 * still for reduced motion).
 */
export function ToolCallCard({
  name,
  running,
}: {
  name: string;
  running: boolean;
}) {
  const theme = useCopilotTheme();
  const pulse = usePulse(PULSE_CYCLE_MS, running);
  const status = running ? "Running" : "Done";

  return (
    <View
      testID="copilot-tool-call"
      accessible
      accessibilityLabel={`${name}: ${status}`}
      style={[
        styles.card,
        { backgroundColor: theme.card, borderColor: theme.border },
      ]}
    >
      <View style={styles.icon}>
        {running ? (
          <ActivityIndicator size="small" color={theme.mutedForeground} />
        ) : (
          <Text style={[styles.check, { color: theme.mutedForeground }]}>
            ✓
          </Text>
        )}
      </View>
      <Animated.View
        style={[
          styles.label,
          {
            opacity: pulse.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0.45],
            }),
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[styles.name, { color: theme.foreground }]}
        >
          {name}
        </Text>
        <Text style={[styles.status, { color: theme.mutedForeground }]}>
          {status}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginVertical: 8,
  },
  icon: {
    width: 20,
    alignItems: "center",
  },
  check: {
    fontSize: 13,
    fontWeight: "600",
  },
  label: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  name: {
    flex: 1,
    fontFamily: MONO_FONT,
    fontSize: 13,
    fontWeight: "500",
  },
  status: {
    fontSize: 12,
  },
});

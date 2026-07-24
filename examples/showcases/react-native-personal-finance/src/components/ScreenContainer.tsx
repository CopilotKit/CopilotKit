/**
 * Reusable screen shell for the finance tracker.
 *
 * Renders a consistent off-white background, an optional large title +
 * subtitle header, and a safe, padded content area. Purely presentational —
 * it takes its title/subtitle/children as props and reads nothing from the
 * store. Pass `scroll={false}` when the child manages its own scrolling (e.g.
 * a top-level FlatList).
 */

import type { ReactNode } from "react";
import { SafeAreaView, ScrollView, Text, View } from "react-native";
import { colors, spacing, typography } from "./theme";

export interface ScreenContainerProps {
  title?: string;
  subtitle?: string;
  /** Wrap children in a padded ScrollView. Defaults to true. */
  scroll?: boolean;
  /** Optional element rendered to the right of the title (e.g. a total). */
  headerRight?: ReactNode;
  children: ReactNode;
}

export function ScreenContainer({
  title,
  subtitle,
  scroll = true,
  headerRight,
  children,
}: ScreenContainerProps) {
  const header =
    title || subtitle ? (
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "space-between",
          paddingHorizontal: spacing.screen,
          paddingTop: spacing.lg,
          paddingBottom: spacing.md,
        }}
      >
        <View style={{ flexShrink: 1 }}>
          {title ? <Text style={typography.screenTitle}>{title}</Text> : null}
          {subtitle ? (
            <Text style={[typography.subtitle, { marginTop: 2 }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {headerRight ? (
          <View style={{ marginLeft: spacing.md }}>{headerRight}</View>
        ) : null}
      </View>
    ) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {header}
      {scroll ? (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: spacing.screen,
            paddingBottom: spacing.xl,
          }}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{children}</View>
      )}
    </SafeAreaView>
  );
}

/**
 * Friendly empty-state block — an emoji, a headline and a hint. Used by every
 * screen so "nothing here yet" looks intentional rather than broken.
 */
export function EmptyState({
  emoji = "📭",
  title,
  hint,
}: {
  emoji?: string;
  title: string;
  hint?: string;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: spacing.xl * 1.5,
        paddingHorizontal: spacing.lg,
      }}
    >
      <Text style={{ fontSize: 40, marginBottom: spacing.sm }}>{emoji}</Text>
      <Text
        style={{
          fontSize: 16,
          fontWeight: "700",
          color: colors.textPrimary,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      {hint ? (
        <Text
          style={{
            fontSize: 14,
            color: colors.textMuted,
            textAlign: "center",
            marginTop: 4,
          }}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Lightweight section heading used between card groups within a screen. */
export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: spacing.lg,
        marginBottom: spacing.sm,
      }}
    >
      <Text style={typography.sectionTitle}>{title}</Text>
      {action ?? null}
    </View>
  );
}

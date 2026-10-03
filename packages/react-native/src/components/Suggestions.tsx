import React from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { Suggestion } from "@copilotkit/core";
import { IntroRise, introDelay } from "./motion";
import type { IntroMode } from "./motion";
import { radius, useCopilotTheme, withOpacity } from "./theme";

interface SuggestionsProps {
  suggestions: Suggestion[];
  onSelect: (suggestion: Suggestion) => void;
}

/**
 * Suggestion pills in a horizontally scrollable row, docked above the input
 * during a conversation.
 */
export function SuggestionBar({ suggestions, onSelect }: SuggestionsProps) {
  const theme = useCopilotTheme();

  return (
    <ScrollView
      testID="copilot-suggestions"
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.bar}
      contentContainerStyle={styles.barContent}
    >
      {suggestions.map((suggestion, index) => (
        <TouchableOpacity
          key={`${suggestion.title}-${index}`}
          accessibilityRole="button"
          activeOpacity={0.7}
          disabled={suggestion.isLoading}
          onPress={() => onSelect(suggestion)}
          style={[
            styles.pill,
            { backgroundColor: theme.card, borderColor: theme.input },
          ]}
        >
          {suggestion.isLoading && (
            <ActivityIndicator size="small" color={theme.mutedForeground} />
          )}
          <Text
            numberOfLines={1}
            style={[
              styles.pillLabel,
              { color: withOpacity(theme.foreground, 0.8) },
            ]}
          >
            {suggestion.title}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

/** A card's body: the suggestion's message, unless it only repeats the title. */
function cardBody(suggestion: Suggestion): string | undefined {
  return suggestion.message && suggestion.message !== suggestion.title
    ? suggestion.message
    : undefined;
}

/**
 * The welcome screen's suggestions: two columns of cards, each a title over two
 * lines of body, or a title of up to three lines when there's no body. Every
 * card is the same height — when any card has a body, all of them reserve room
 * for it. Cards rise in one after another as part of the welcome intro.
 */
export function SuggestionGrid({
  suggestions,
  onSelect,
  introMode,
}: SuggestionsProps & { introMode: IntroMode }) {
  const theme = useCopilotTheme();
  const reserveBody = suggestions.some((suggestion) => cardBody(suggestion));

  const rows: Suggestion[][] = [];
  for (let i = 0; i < suggestions.length; i += 2) {
    rows.push(suggestions.slice(i, i + 2));
  }

  return (
    <View testID="copilot-suggestions" style={styles.grid}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((suggestion, column) => {
            const index = rowIndex * 2 + column;
            const body = cardBody(suggestion);
            return (
              <IntroRise
                key={`${suggestion.title}-${index}`}
                mode={introMode}
                delay={introDelay.card(index)}
                style={styles.cell}
              >
                <TouchableOpacity
                  accessibilityRole="button"
                  activeOpacity={0.7}
                  disabled={suggestion.isLoading}
                  onPress={() => onSelect(suggestion)}
                  style={[
                    styles.card,
                    { backgroundColor: theme.card, borderColor: theme.input },
                  ]}
                >
                  <View style={styles.cardHeader}>
                    {suggestion.isLoading && (
                      <ActivityIndicator
                        size="small"
                        color={theme.mutedForeground}
                      />
                    )}
                    <Text
                      numberOfLines={body ? 1 : 3}
                      style={[
                        styles.cardTitle,
                        !body && reserveBody && styles.cardTitleReserved,
                        { color: theme.foreground },
                      ]}
                    >
                      {suggestion.title}
                    </Text>
                  </View>
                  {body ? (
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.cardBody,
                        { color: theme.mutedForeground },
                      ]}
                    >
                      {body}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              </IntroRise>
            );
          })}
          {/* Keep a lone last card in its column. */}
          {row.length === 1 && <View style={styles.cell} />}
        </View>
      ))}
    </View>
  );
}

const CARD_GAP = 4;
const CARD_TITLE_LINE_HEIGHT = 20;
const CARD_BODY_LINE_HEIGHT = 18;

const styles = StyleSheet.create({
  bar: {
    flexGrow: 0,
  },
  barContent: {
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
  },
  pillLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  grid: {
    gap: 8,
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  cell: {
    flex: 1,
  },
  card: {
    flex: 1,
    gap: CARD_GAP,
    borderWidth: 1,
    borderRadius: radius["2xl"],
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cardTitle: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: CARD_TITLE_LINE_HEIGHT,
  },
  /** A title without a body, as tall as a card with one. */
  cardTitleReserved: {
    minHeight: CARD_TITLE_LINE_HEIGHT + CARD_GAP + CARD_BODY_LINE_HEIGHT * 2,
  },
  cardBody: {
    fontSize: 13,
    lineHeight: CARD_BODY_LINE_HEIGHT,
    minHeight: CARD_BODY_LINE_HEIGHT * 2,
  },
});

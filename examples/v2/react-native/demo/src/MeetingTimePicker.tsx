import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

interface TimeSlot {
  date: string;
  time: string;
  duration: string;
}

export type MeetingTimePickerStatus = "loading" | "selecting" | "confirmed" | "declined";

interface Props {
  status: MeetingTimePickerStatus;
  reason?: string;
  duration?: number;
  selectedSlot?: TimeSlot | null;
  onSelect?: (slot: TimeSlot) => void;
  onDecline?: () => void;
}

const DEFAULT_SLOTS: TimeSlot[] = [
  { date: "Tomorrow", time: "2:00 PM", duration: "30 min" },
  { date: "Friday", time: "10:00 AM", duration: "30 min" },
  { date: "Next Monday", time: "3:00 PM", duration: "30 min" },
];

export function MeetingTimePicker({
  status,
  reason,
  duration,
  selectedSlot,
  onSelect,
  onDecline,
}: Props) {
  const slots = duration
    ? DEFAULT_SLOTS.map((s) => ({ ...s, duration: `${duration} min` }))
    : DEFAULT_SLOTS;

  if (status === "confirmed" && selectedSlot) {
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.iconCircleGreen}>
            <Text style={styles.iconText}>✓</Text>
          </View>
          <Text style={styles.title}>Meeting Scheduled</Text>
          <Text style={styles.subtitle}>
            {selectedSlot.date} at {selectedSlot.time}
          </Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{selectedSlot.duration}</Text>
          </View>
        </View>
      </View>
    );
  }

  if (status === "declined") {
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.iconCircleGray}>
            <Text style={styles.iconText}>✕</Text>
          </View>
          <Text style={styles.title}>No Time Selected</Text>
          <Text style={styles.subtitle}>
            Looking for a better time that works for you
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.iconCirclePurple}>
          <Text style={styles.iconText}>⏰</Text>
        </View>
        <Text style={styles.title}>{reason || "Schedule a Meeting"}</Text>
        <Text style={styles.subtitle}>
          {status === "loading"
            ? "Finding available times..."
            : "Pick a time that works for you"}
        </Text>
      </View>

      {status === "loading" && (
        <ActivityIndicator
          size="large"
          color="#6366f1"
          style={styles.spinner}
        />
      )}

      {status === "selecting" && (
        <View style={styles.slotsContainer}>
          {slots.map((slot, i) => (
            <Pressable
              key={i}
              style={({ pressed }) => [
                styles.slotButton,
                pressed && styles.slotButtonPressed,
              ]}
              onPress={() => onSelect?.(slot)}
            >
              <View style={styles.slotInfo}>
                <Text style={styles.slotDate}>{slot.date}</Text>
                <Text style={styles.slotTime}>{slot.time}</Text>
              </View>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{slot.duration}</Text>
              </View>
            </Pressable>
          ))}
          <Pressable style={styles.declineButton} onPress={onDecline}>
            <Text style={styles.declineText}>None of these work</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    width: "100%",
  },
  cardHeader: {
    alignItems: "center",
    marginBottom: 4,
  },
  iconCircleGreen: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#189370",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  iconCircleGray: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  iconCirclePurple: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#e0e1ff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  iconText: { fontSize: 18, color: "#fff", fontWeight: "700" },
  title: { fontSize: 17, fontWeight: "700", color: "#1a1a1a", marginBottom: 4 },
  subtitle: { fontSize: 13, color: "#666", marginBottom: 12, textAlign: "center" },
  spinner: { marginVertical: 16 },
  slotsContainer: { width: "100%", gap: 8 },
  slotButton: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  slotButtonPressed: { backgroundColor: "#f3f4ff", borderColor: "#6366f1" },
  slotInfo: { flex: 1 },
  slotDate: { fontSize: 15, fontWeight: "600", color: "#1a1a1a" },
  slotTime: { fontSize: 13, color: "#666", marginTop: 2 },
  badge: {
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexShrink: 0,
  },
  badgeText: { fontSize: 12, color: "#666", fontWeight: "500" },
  declineButton: { alignItems: "center", paddingVertical: 8, marginTop: 2 },
  declineText: { fontSize: 12, color: "#999" },
});

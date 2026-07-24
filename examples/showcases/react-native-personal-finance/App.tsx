/**
 * Personal Finance Copilot — app shell.
 * https://docs.copilotkit.ai/react-native
 *
 * Provider stack: SafeAreaProvider › CopilotKitProvider › app body.
 * `<FinanceCopilot/>` is mounted ONCE inside the provider so every CopilotKit
 * tool (reads, transactions, accounts, budgets, receipt) is registered for the
 * whole app, regardless of which tab is on screen. A simple state-driven bottom
 * tab bar (no react-navigation) switches between the four data screens and the
 * Assistant chat.
 *
 * @format
 */

import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { CopilotKitProvider } from "@copilotkit/react-native";

import { ChatScreen } from "./src/ChatScreen";
import { FinanceCopilot } from "./src/copilot";
import { configureReceiptEndpoint } from "./src/copilot/receipt";
import DashboardScreen from "./src/screens/DashboardScreen";
import AccountsScreen from "./src/screens/AccountsScreen";
import TransactionsScreen from "./src/screens/TransactionsScreen";
import BudgetsScreen from "./src/screens/BudgetsScreen";
import { colors, spacing } from "./src/components/theme";

/**
 * Base URL of the backend that hosts BOTH the CopilotKit runtime
 * (`${RUNTIME_BASE}/api/copilotkit`) and the receipt parser
 * (`${RUNTIME_BASE}/api/receipt`).
 *
 *   • Local dev (e.g. the bundled Next.js runtime in ./runtime): the iOS
 *     simulator and `localhost` share a network, so this default works.
 *   • Physical device (or Android emulator): `localhost` points at the device
 *     itself, NOT your dev machine — change this to your machine's LAN IP,
 *     e.g. 'http://192.168.1.42:3000'. (Android emulator alias: 'http://10.0.2.2:3000'.)
 */
const RUNTIME_BASE = "http://localhost:3000";

/** Full CopilotKit runtime endpoint derived from the shared base. */
const RUNTIME_URL = `${RUNTIME_BASE}/api/copilotkit`;

// Point the receipt parser at the same backend as the runtime. Done once at
// module load (before any component mounts) so the first attach already targets
// the right host. `configureReceiptEndpoint` appends `/api/receipt` for us.
configureReceiptEndpoint(RUNTIME_BASE);

type TabKey =
  | "dashboard"
  | "accounts"
  | "transactions"
  | "budgets"
  | "assistant";

interface TabDef {
  key: TabKey;
  label: string;
  emoji: string;
}

const TABS: TabDef[] = [
  { key: "dashboard", label: "Dashboard", emoji: "📊" },
  { key: "accounts", label: "Accounts", emoji: "🏦" },
  { key: "transactions", label: "Transactions", emoji: "💸" },
  { key: "budgets", label: "Budgets", emoji: "🎯" },
  { key: "assistant", label: "Assistant", emoji: "🤖" },
];

/** Render the screen for the active tab. */
function ActiveScreen({ tab }: { tab: TabKey }) {
  switch (tab) {
    case "dashboard":
      return <DashboardScreen />;
    case "accounts":
      return <AccountsScreen />;
    case "transactions":
      return <TransactionsScreen />;
    case "budgets":
      return <BudgetsScreen />;
    case "assistant":
      return <ChatScreen />;
  }
}

/** State-based bottom tab bar (no react-navigation). */
function TabBar({
  active,
  onSelect,
}: {
  active: TabKey;
  onSelect: (key: TabKey) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.tabBar,
        { paddingBottom: Math.max(insets.bottom, spacing.sm) },
      ]}
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tabItem}
            onPress={() => onSelect(tab.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.label}
          >
            <Text style={[styles.tabEmoji, !isActive && styles.tabInactive]}>
              {tab.emoji}
            </Text>
            <Text
              style={[
                styles.tabLabel,
                isActive ? styles.tabLabelActive : styles.tabInactive,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** App body: lives INSIDE the providers so it can use CopilotKit + safe-area. */
function AppShell() {
  const [tab, setTab] = useState<TabKey>("dashboard");
  return (
    // `<FinanceCopilot/>` registers every CopilotKit tool once (renders no UI of
    // its own) AND provides the receipt-capture context to the screens it wraps,
    // so the Assistant tab's 📎 button can call `useReceiptCapture()`.
    <FinanceCopilot>
      <View style={styles.body}>
        <View style={styles.screen}>
          <ActiveScreen tab={tab} />
        </View>
        <TabBar active={tab} onSelect={setTab} />
      </View>
    </FinanceCopilot>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <CopilotKitProvider runtimeUrl={RUNTIME_URL}>
        <SafeAreaView style={styles.root} edges={["top"]}>
          <AppShell />
        </SafeAreaView>
      </CopilotKitProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1 },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
    paddingTop: spacing.sm,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xs,
  },
  tabEmoji: { fontSize: 22, marginBottom: 2 },
  tabLabel: { fontSize: 11, fontWeight: "600" },
  tabLabelActive: { color: colors.accent },
  tabInactive: { opacity: 0.55, color: colors.textMuted },
});

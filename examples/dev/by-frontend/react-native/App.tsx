import { StatusBar, useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CopilotKitProvider } from "@copilotkit/react-native";
import { ChatScreen } from "./src/ChatScreen";

const RUNTIME_URL =
  "https://langgraph-py.examples.copilotkit.ai/api/copilotkit";

function App() {
  const isDarkMode = useColorScheme() === "dark";

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
      <CopilotKitProvider runtimeUrl={RUNTIME_URL}>
        <ChatScreen />
      </CopilotKitProvider>
    </SafeAreaProvider>
  );
}

export default App;

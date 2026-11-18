/**
 * @format
 */

// CopilotKit polyfills — must be imported before any CopilotKit code
import "@copilotkit/react-native/polyfills";

import { AppRegistry } from "react-native";
import App from "./App";
import { name as appName } from "./app.json";

AppRegistry.registerComponent(appName, () => App);

// Same shape as tiny-headless.js plus the failure this guards against: a stray
// web-oriented edge into react-dom/client. Used to prove HEADLESS_EXTERNAL
// actually keeps react-dom OUT of the measured graph.
//
// react-dom/client (not bare react-dom) is the edge worth simulating: bare
// react-dom is a ~7 kB wrapper, while react-dom/client drags in
// react-dom-client.production.js (~536 kB raw) and is what would visibly
// inflate the reported figure.
import { createRoot } from "react-dom/client";

export const CopilotKitProvider = () => createRoot;
export const useAgent = () => null;
export const useFrontendTool = () => null;
export const useRenderTool = () => null;
export const useRenderToolCall = () => null;
export const useComponent = () => null;

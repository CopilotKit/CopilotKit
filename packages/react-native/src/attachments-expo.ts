/**
 * @copilotkit/react-native/attachments
 *
 * Expo-backed attachment implementation for React Native.
 * Requires expo-document-picker and expo-file-system to be installed.
 *
 * Import from the /attachments subpath:
 *   import { useAttachments } from "@copilotkit/react-native/attachments";
 */

// Re-export the types from the stub so consumers can import from one place
export type {
  NativeFileInput,
  NativeAttachmentsConfig,
  UseNativeAttachmentsProps,
  UseNativeAttachmentsReturn,
} from "./attachments-stub";

export { useAttachments } from "./hooks/use-attachments";

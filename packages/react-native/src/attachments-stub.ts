/**
 * @copilotkit/react-native/attachments stub
 *
 * This stub is exported from the main @copilotkit/react-native entry point
 * to prevent Metro bundler from resolving expo-document-picker and
 * expo-file-system when those optional packages are not installed.
 *
 * To use attachments in React Native, install the Expo packages:
 *   npm install expo-document-picker expo-file-system
 *
 * Then import from the /attachments subpath:
 *   import { useAttachments } from "@copilotkit/react-native/attachments";
 */

import { useCallback, useState } from "react";
import type {
  Attachment,
  AttachmentUploadResult,
  AttachmentUploadErrorReason,
} from "@copilotkit/shared";

export interface NativeFileInput {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface NativeAttachmentsConfig {
  enabled: boolean;
  accept?: string;
  maxSize?: number;
  onUpload?: (
    file: NativeFileInput,
  ) => AttachmentUploadResult | Promise<AttachmentUploadResult>;
  onUploadFailed?: (error: {
    reason: AttachmentUploadErrorReason;
    file: NativeFileInput;
    message: string;
  }) => void;
}

export interface UseNativeAttachmentsProps {
  config?: NativeAttachmentsConfig;
}

export interface UseNativeAttachmentsReturn {
  attachments: Attachment[];
  enabled: boolean;
  openPicker: () => Promise<void>;
  processFiles: (files: NativeFileInput[]) => Promise<void>;
  removeAttachment: (id: string) => void;
  consumeAttachments: () => Attachment[];
}

const EXPO_INSTALL_MESSAGE = `\nAttachments require optional Expo dependencies. Install them:\n  npm install expo-document-picker expo-file-system\n\nThen import from the /attachments subpath:\n  import { useAttachments } from "@copilotkit/react-native/attachments";`;

/**
 * Stub implementation of useAttachments that throws when attachments are enabled.
 *
 * This prevents Metro from attempting to resolve expo-document-picker and
 * expo-file-system when they're not installed. Users who want attachments
 * must import from @copilotkit/react-native/attachments after installing
 * the Expo packages.
 */
export function useAttachments({
  config,
}: UseNativeAttachmentsProps): UseNativeAttachmentsReturn {
  const [attachments] = useState<Attachment[]>([]);
  const enabled = config?.enabled ?? false;

  const openPicker = useCallback(async () => {
    if (enabled) {
      throw new Error(
        `Attachments are enabled but Expo modules are not installed.${EXPO_INSTALL_MESSAGE}`,
      );
    }
  }, [enabled]);

  const processFiles = useCallback(
    async (_files: NativeFileInput[]) => {
      if (enabled) {
        throw new Error(
          `Attachments are enabled but Expo modules are not installed.${EXPO_INSTALL_MESSAGE}`,
        );
      }
    },
    [enabled],
  );

  const removeAttachment = useCallback((_id: string) => {
    // no-op
  }, []);

  const consumeAttachments = useCallback(() => {
    return [];
  }, []);

  return {
    attachments,
    enabled,
    openPicker,
    processFiles,
    removeAttachment,
    consumeAttachments,
  };
}

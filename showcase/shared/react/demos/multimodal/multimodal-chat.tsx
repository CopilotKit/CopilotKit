"use client";

// Canonical source; materialized into each selected integration by
// showcase/scripts/sync-shared-frontends.ts.

import { useCallback } from "react";
import { CopilotChat } from "@copilotkit/react-core/v2";
import { fileToDataAttachment } from "./file-to-data-attachment";
import { SampleAttachmentButtons } from "./sample-attachment-buttons";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPT_MIME = "image/*,application/pdf";

export function MultimodalChat() {
  // `onUpload` is passed into CopilotChat's `AttachmentsConfig` for the
  // paperclip path. Sample buttons build the equivalent data attachment
  // directly so their canned prompt can be dispatched as one atomic turn.
  const onUpload = useCallback(fileToDataAttachment, []);

  return (
    <>
      {/*
       * Scoped CSS:
       * - `multimodal-attach-attention`: one-shot bounce when the page loads
       *   (lasts ~2.4s, three bounces, then settles). Uses `forwards` so the
       *   button stays at rest after the animation completes — no ambient
       *   jitter that would distract once the user has noticed it.
       * - The `:hover` rule scales the button gently so users get tactile
       *   feedback even after the intro animation has ended.
       *
       * Targeting `[data-testid="copilot-add-menu-button"]` instead of
       * passing a slot override keeps the override surface tiny — the button
       * markup, accessibility, and dropdown wiring all stay owned by
       * CopilotChatInput.
       */}
      <style>{`
        @keyframes multimodal-attach-attention {
          0%, 100% { transform: translateY(0); }
          15% { transform: translateY(-6px); }
          30% { transform: translateY(0); }
          45% { transform: translateY(-4px); }
          60% { transform: translateY(0); }
          75% { transform: translateY(-2px); }
          90% { transform: translateY(0); }
        }
        [data-multimodal-demo-chat-root] [data-testid="copilot-add-menu-button"] {
          animation: multimodal-attach-attention 2.4s ease-in-out 0.4s 1 both;
          transition: transform 150ms ease-out, background-color 150ms ease-out;
        }
        [data-multimodal-demo-chat-root] [data-testid="copilot-add-menu-button"]:hover {
          transform: scale(1.12);
        }
        @media (prefers-reduced-motion: reduce) {
          [data-multimodal-demo-chat-root] [data-testid="copilot-add-menu-button"] {
            animation: none;
          }
        }
      `}</style>
      <div
        data-testid="multimodal-demo-root"
        className="mx-auto flex h-screen max-w-4xl flex-col gap-3 p-4 sm:p-6"
      >
        <SampleAttachmentButtons agentId="multimodal-demo" />

        <div
          data-multimodal-demo-chat-root
          className="min-h-0 flex-1 overflow-hidden rounded-lg border border-black/10 dark:border-white/10"
        >
          {/* @region[multimodal-attachments] */}
          <CopilotChat
            agentId="multimodal-demo"
            className="h-full"
            attachments={{
              enabled: true,
              accept: ACCEPT_MIME,
              maxSize: MAX_FILE_SIZE_BYTES,
              onUpload,
              onUploadFailed: (err) => {
                // Log without disrupting the default UI — CopilotChat already
                // shows a toast-style indicator on validation failure.
                console.warn("[multimodal-demo] attachment rejected", err);
              },
            }}
          />
          {/* @endregion[multimodal-attachments] */}
        </div>
      </div>
    </>
  );
}

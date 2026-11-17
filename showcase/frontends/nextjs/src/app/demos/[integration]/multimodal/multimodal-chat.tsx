"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { fileToDataAttachment } from "./file-to-data-attachment";
import { SampleAttachmentButtons } from "./sample-attachment-buttons";

const AGENT_ID = "multimodal-demo";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPT_MIME = "image/*,application/pdf";

export function MultimodalChat() {
  return (
    <>
      {/*
       * Scoped CSS:
       * - `multimodal-attach-attention`: the attach button bounces three
       *   times when the page loads (about 2.4s), then rests. `both` keeps
       *   it at rest after the animation, so it does not distract once the
       *   user has seen it.
       * - The `:hover` rule scales the button a little, so it still reacts
       *   after the animation.
       *
       * The CSS targets `[data-testid="copilot-add-menu-button"]` instead of
       * overriding a slot, so CopilotChatInput keeps the button's markup,
       * accessibility and dropdown.
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
        <SampleAttachmentButtons agentId={AGENT_ID} />

        <div
          data-multimodal-demo-chat-root
          className="min-h-0 flex-1 overflow-hidden rounded-lg border border-black/10 dark:border-white/10"
        >
          <CopilotChat
            agentId={AGENT_ID}
            className="h-full"
            attachments={{
              enabled: true,
              accept: ACCEPT_MIME,
              maxSize: MAX_FILE_SIZE_BYTES,
              onUpload: fileToDataAttachment,
              onUploadFailed: (err) => {
                // CopilotChat already shows a notice when a file is
                // rejected, so only log it.
                console.warn("[multimodal-demo] attachment rejected", err);
              },
            }}
          />
        </div>
      </div>
    </>
  );
}

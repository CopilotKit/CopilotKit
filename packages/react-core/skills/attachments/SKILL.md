---
name: attachments
description: >
  Manage file / image / audio / video / document attachments in chat via
  useAttachments — drag-and-drop, click-to-upload, clipboard paste, custom
  backends (onUpload), 20MB byte-sized default maxSize, queue draining via
  consumeAttachments. Powers the attachments prop on <CopilotChat>. Replaces
  the v1 imageUploadsEnabled flag. Load when enabling image uploads, wiring
  S3 / presigned URL backends, or building a custom chat surface that
  supports paste-to-attach.
type: framework
framework: react
library: copilotkit
library_version: "1.56.2"
requires:
  - copilotkit/provider-setup
  - copilotkit/chat-components
sources:
  - "CopilotKit/CopilotKit:packages/react-core/src/v2/hooks/use-attachments.tsx"
  - "CopilotKit/CopilotKit:docs/content/docs/(root)/migration-guides/migrate-attachments.mdx"
---

# CopilotKit Attachments (React)

This skill builds on `copilotkit/provider-setup` and
`copilotkit/chat-components`. `useAttachments` is exposed both as an opt-in
prop on `<CopilotChat>` and as a direct hook for custom chat surfaces.

## Setup

### Easiest: turn attachments on via `<CopilotChat>`

```tsx
"use client";
import { CopilotChat } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

export function ChatPanel() {
  return (
    <CopilotChat
      agentId="default"
      attachments={{
        enabled: true,
        accept: "image/*",
        maxSize: 10 * 1024 * 1024, // 10 MB
        onUploadFailed: ({ reason, file, message }) => {
          console.warn(`[attachments] ${reason}: ${file.name} — ${message}`);
        },
      }}
    />
  );
}
```

### Direct hook usage for custom surfaces

```tsx
"use client";
import { useAttachments, useAgent } from "@copilotkit/react-core/v2";

export function CustomChatInput() {
  const { agent } = useAgent({ agentId: "default" });
  const {
    attachments,
    containerRef,
    fileInputRef,
    handleFileUpload,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeAttachment,
    consumeAttachments,
  } = useAttachments({ config: { enabled: true, accept: "*/*" } });

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} />
      {attachments.map((a) => (
        <button key={a.id} onClick={() => removeAttachment(a.id)}>
          {a.filename} ({a.status})
        </button>
      ))}
      <button
        onClick={() => {
          const ready = consumeAttachments();
          agent.addMessage({
            id: crypto.randomUUID(),
            role: "user",
            content: [{ type: "text", text: "See attachments." }, ...ready],
          });
        }}
      >
        Send
      </button>
    </div>
  );
}
```

## Core Patterns

### Custom upload backend (S3 / presigned URL)

`onUpload` replaces the default base64-inline strategy. Return an
`Attachment.source` describing where the file lives.

```tsx
useAttachments({
  config: {
    enabled: true,
    accept: "image/*,application/pdf",
    maxSize: 50 * 1024 * 1024,
    onUpload: async (file) => {
      const { url } = await fetch("/api/upload", {
        method: "POST",
        body: file,
      }).then((r) => r.json());
      return { type: "url", value: url, mimeType: file.type };
    },
    onUploadFailed: ({ reason, file, message }) => {
      toast.error(`${file.name}: ${message}`);
    },
  },
});
```

### Feedback on failed uploads

```tsx
useAttachments({
  config: {
    enabled: true,
    maxSize: 5 * 1024 * 1024,
    onUploadFailed: ({ reason, file, message }) => {
      // reason: "file-too-large" | "invalid-type" | "upload-failed"
      toast.error(message);
    },
  },
});
```

## Common Mistakes

### HIGH — Forgetting to call `consumeAttachments` on submit

Wrong:

```tsx
const { attachments } = useAttachments({ config: { enabled: true } });
const onSubmit = () => {
  sendMessage({ text, attachments });
  // attachments queue never cleared — sticks around for the next message
};
```

Correct:

```tsx
const { consumeAttachments } = useAttachments({ config: { enabled: true } });
const onSubmit = () => {
  const ready = consumeAttachments();
  sendMessage({ text, attachments: ready });
};
```

`consumeAttachments()` returns ready attachments AND drains the internal
queue. If you submit without calling it, attachments stay in state and
accompany every subsequent message.

Source: `packages/react-core/src/v2/hooks/use-attachments.tsx:40-46`

### HIGH — Passing `maxSize` in KB or MB

Wrong:

```tsx
useAttachments({ config: { enabled: true, maxSize: 10 } });
// 10 bytes! Effectively blocks every file.
```

Correct:

```tsx
useAttachments({
  config: { enabled: true, maxSize: 10 * 1024 * 1024 }, // 10 MB
});
```

`maxSize` is bytes. The default is `20 * 1024 * 1024` (20 MB). Passing a
small number without the multiplier silently rejects every file via
`onUploadFailed({ reason: "file-too-large" })`.

Source: `packages/react-core/src/v2/hooks/use-attachments.tsx:73-74`

### HIGH — Missing `containerRef` on the paste-scope element

Wrong:

```tsx
const { enabled } = useAttachments({ config: { enabled: true } });
return (
  <div>
    <input type="text" />
  </div>
); // no containerRef attached
```

Correct:

```tsx
const { containerRef, handleDragOver, handleDrop } = useAttachments({
  config: { enabled: true },
});
return (
  <div ref={containerRef} onDragOver={handleDragOver} onDrop={handleDrop}>
    <input type="text" />
  </div>
);
```

Clipboard paste is scoped to the element `containerRef` points at. Without
attaching the ref, `Ctrl+V` / `Cmd+V` never reaches the paste handler and
users silently can't paste images from screenshots.

Source: `packages/react-core/src/v2/hooks/use-attachments.tsx:207-239`

### MEDIUM — Using `imageUploadsEnabled` on `<CopilotChat>`

Wrong:

```tsx
<CopilotChat imageUploadsEnabled />
```

Correct:

```tsx
<CopilotChat
  attachments={{
    enabled: true,
    accept: "image/*",
    maxSize: 5 * 1024 * 1024,
  }}
/>
```

`imageUploadsEnabled` was the v1 flag. v2 replaces it with the `attachments`
config object, which is powered by `useAttachments` internally and supports
any MIME type, not only images.

Source: `docs/content/docs/(root)/migration-guides/migrate-attachments.mdx`

### MEDIUM — Ignoring `onUploadFailed`

Wrong:

```tsx
useAttachments({ config: { enabled: true } });
// Rejected files silently disappear. User has no idea why.
```

Correct:

```tsx
useAttachments({
  config: {
    enabled: true,
    onUploadFailed: ({ reason, file, message }) => {
      toast.error(message);
    },
  },
});
```

Size violations, MIME mismatches, and `onUpload` throws all drop the file
from the queue with no UI feedback unless `onUploadFailed` is wired.

Source: `packages/react-core/src/v2/hooks/use-attachments.tsx:79-157`

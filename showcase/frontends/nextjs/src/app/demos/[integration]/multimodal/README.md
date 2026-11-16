# Multimodal attachments

Users want to ask about an image or a PDF. In this demo, they attach the file in the chat, and a vision-capable agent answers about it.

## Try it

1. Open `/demos/<integration>/multimodal`.
2. Click "Try with sample image". You can also attach your own file with the paperclip button.

The user message shows one image chip, and the agent describes the image. "Try with sample PDF" shows one PDF chip.

## How it works

- `multimodal-chat.tsx` turns on the chat's `attachments` for images and PDFs, up to 10 MB.
- `file-to-data-attachment.ts` puts each file into the message as base64.
- `sample-attachment-buttons.tsx` sends a sample file with a fixed prompt. It loads `/demo-files/sample.png` and `/demo-files/sample.pdf`.
- `attachment-repair.ts` repairs attachments that the agent sends back in a shape the chat cannot render. `attachment-repair-subscription.tsx` subscribes it to the chat's agent.

## What the integration needs

- An agent for `createRuntimeConfig("multimodal")`, with the id `multimodal-demo`. The agent accepts AG-UI `image` and `document` parts.
- The two sample files in the app's `public/demo-files/` folder.

Each attachment shows once, with the right chip, after every reply.

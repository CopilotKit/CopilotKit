# QA: Multimodal Attachments — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/copilotkit)
- Backend uses Claude Sonnet (vision-capable) for this route

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/multimodal`
- [ ] Verify the chat interface loads
- [ ] Verify the header "Multimodal attachments"
- [ ] Verify two sample-attachment buttons are visible: "Try with sample image" and "Try with sample PDF"

### 2. Image Attachments

- [ ] Click "Try with sample image"
- [ ] Type "What do you see in this image?"
- [ ] Verify Claude describes the image content

### 3. PDF Attachments

- [ ] Click "Try with sample PDF"
- [ ] Type "What's this document about?"
- [ ] Verify Claude summarizes the PDF content

### 4. Upload via paperclip

- [ ] Click the paperclip icon in the composer
- [ ] Upload a local .png or .pdf (< 10MB)
- [ ] Verify attachment appears in the composer
- [ ] Send a question about the attachment

### 5. Error Handling

- [ ] Verify files >10MB are rejected with a visible error
- [ ] Verify invalid mime types are rejected

## Expected Results

- Chat loads within 3 seconds
- Claude describes image / PDF content accurately within 20 seconds
- No console errors during normal usage

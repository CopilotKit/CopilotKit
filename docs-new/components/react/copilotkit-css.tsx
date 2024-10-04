"use client";

import React from "react";
import { Frame } from "./frame";

export function CopilotKitCSS() {
  return (
    <style suppressHydrationWarning>
      {`
/* src/css/colors.css */
html {
  --copilot-kit-primary-color: rgb(59 130 246);
  --copilot-kit-contrast-color: rgb(255 255 255);
  --copilot-kit-secondary-color: rgb(243 244 246);
  --copilot-kit-secondary-contrast-color: rgb(0 0 0);
  --copilot-kit-background-color: rgb(255 255 255);
  --copilot-kit-muted-color: rgb(106 106 106);
  --copilot-kit-separator-color: rgba(0, 0, 0, 0.08);
  --copilot-kit-scrollbar-color: rgba(0, 0, 0, 0.2);
  --copilot-kit-response-button-color: #333;
  --copilot-kit-response-button-background-color: #fff;
}

/* src/css/popup.css */
.copilotKitPopup {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  z-index: 30;
  line-height: 1.5;
  -webkit-text-size-adjust: 100%;
  -moz-tab-size: 4;
  -o-tab-size: 4;
  tab-size: 4;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif,
    "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
  font-feature-settings: normal;
  font-variation-settings: normal;
  touch-action: manipulation;
}
.copilotKitPopup svg {
  display: inline-block;
  vertical-align: middle;
}

/* src/css/sidebar.css */
.copilotKitSidebar {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  z-index: 30;
  line-height: 1.5;
  -webkit-text-size-adjust: 100%;
  -moz-tab-size: 4;
  -o-tab-size: 4;
  tab-size: 4;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif,
    "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
  font-feature-settings: normal;
  font-variation-settings: normal;
  touch-action: manipulation;
}
.copilotKitSidebar svg {
  display: inline-block;
  vertical-align: middle;
}
.copilotKitSidebarContentWrapper {
  overflow: visible;
  margin-right: 0px;
  transition: margin-right 0.3s ease;
}
@media (min-width: 640px) {
  .copilotKitSidebarContentWrapper.sidebarExpanded {
    margin-right: 28rem;
  }
}

/* src/css/button.css */
.copilotKitButton {
  width: 3.5rem;
  height: 3.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.2);
  outline: none;
  position: relative;
  transform: scale(1);
  transition: transform 200ms;
  background-color: var(--copilot-kit-primary-color);
  color: var(--copilot-kit-contrast-color);
  cursor: pointer;
}
.copilotKitButton:hover {
  transform: scale(1.1);
}
.copilotKitButton:active {
  transform: scale(0.75);
}
.copilotKitButtonIcon {
  transition: opacity 100ms, transform 300ms;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
.copilotKitButton.open .copilotKitButtonIconOpen {
  transform: translate(-50%, -50%) scale(0) rotate(90deg);
  opacity: 0;
}
.copilotKitButton.open .copilotKitButtonIconClose {
  transform: translate(-50%, -50%) scale(1) rotate(0deg);
  opacity: 1;
}
.copilotKitButton:not(.open) .copilotKitButtonIconOpen {
  transform: translate(-50%, -50%) scale(1) rotate(0deg);
  opacity: 1;
}
.copilotKitButton:not(.open) .copilotKitButtonIconClose {
  transform: translate(-50%, -50%) scale(0) rotate(-90deg);
  opacity: 0;
}

/* src/css/header.css */
.copilotKitHeader {
  height: 56px;
  font-weight: 500;
  display: flex;
  justify-content: center;
  align-items: center;  
  position: relative;
  background-color: var(--copilot-kit-primary-color);
  color: var(--copilot-kit-contrast-color);
  border-top-left-radius: 0;
  border-top-right-radius: 0;
  border-bottom: 1px solid var(--copilot-kit-separator-color);
}
.copilotKitSidebar .copilotKitHeader {
  border-radius: 0;
}
@media (min-width: 640px) {
  .copilotKitHeader {
    padding-left: 24px;
    padding-right: 24px;
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
  }
}
.copilotKitHeader button {
  border: 0;
  padding: 0px;
  position: absolute;
  top: 50%;
  right: 16px;
  transform: translateY(-50%);
  outline: none;
  color: var(--copilot-kit-contrast-color);
  background-color: transparent;
  cursor: pointer;
}
.copilotKitHeader button:focus {
  outline: none;
}

/* src/css/input.css */
.copilotKitInput {
  border-top: 1px solid var(--copilot-kit-separator-color);
  padding-left: 2rem;
  padding-right: 1rem;
  padding-top: 1rem;
  padding-bottom: 1rem;
  display: flex;
  align-items: center;
  cursor: text;
  position: relative;
  border-bottom-left-radius: 0.75rem;
  border-bottom-right-radius: 0.75rem;
  background-color: var(--copilot-kit-background-color);
}

.copilotKitInput .copilotKitInputControls button {
  padding: 0.25rem;
  cursor: pointer;
  transition-property: transform;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 200ms;
  transform: scale(1);
  color: rgba(0, 0, 0, 0.25);
  -webkit-appearance: button;
  appearance: button;
  background-color: transparent;
  background-image: none;
  text-transform: none;
  font-family: inherit;
  font-size: 100%;
  font-weight: inherit;
  line-height: inherit;
  border: 0;
  margin: 0;
  text-indent: 0px;
  text-shadow: none;
  display: inline-block;
  text-align: center;
  margin-left: 0.5rem;
}
.copilotKitInput .copilotKitInputControls button:not([disabled]) {
  color: var(--copilot-kit-primary-color);
}
.copilotKitInput .copilotKitInputControls button:not([disabled]):hover {
  transform: scale(1.1);
}
.copilotKitInput .copilotKitInputControls button[disabled] {
  color: var(--copilot-kit-muted-color);
}
.copilotKitInputControls {
  display: flex;
}
.copilotKitInput textarea {
  flex: 1;
  outline: 2px solid transparent;
  outline-offset: 2px;
  resize: none;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  cursor: text;
  font-size: 0.875rem;
  line-height: 1.25rem;
  margin: 0;
  padding: 0;
  font-family: inherit;
  font-weight: inherit;
  color: var(--copilot-kit-secondary-contrast-color);
  border: 0px;
  background-color: var(--copilot-kit-background-color);
}
.copilotKitInput textarea::placeholder {
  color: var(--copilot-kit-muted-color);
  opacity: 1;
}
.copilotKitInput .copilotKitInputControls button.copilotKitPushToTalkRecording {
  background-color: red;
  color: white;
  border-radius: 50%;
  animation: copilotKitPulseAnimation 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

/* src/css/messages.css */
.copilotKitMessages {
  overflow-y: scroll;
  flex: 1;
  padding: 1rem 2rem;
  display: flex;
  flex-direction: column;
  background-color: var(--copilot-kit-background-color);
}
.copilotKitMessages::-webkit-scrollbar {
  width: 9px;
}
.copilotKitMessages::-webkit-scrollbar-thumb {
  background-color: var(--copilot-kit-scrollbar-color);
  border-radius: 10rem;
  border: 2px solid var(--copilot-kit-background-color);
}
.copilotKitMessages::-webkit-scrollbar-track-piece:start {
  background: transparent;
}
.copilotKitMessages::-webkit-scrollbar-track-piece:end {
  background: transparent;
}
.copilotKitMessage {
  border-radius: 0.5rem;
  padding: 1rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  overflow-wrap: break-word;
  max-width: 80%;
  margin-bottom: 0.5rem;
}
.copilotKitMessage.copilotKitUserMessage {
  background: var(--copilot-kit-primary-color);
  color: var(--copilot-kit-contrast-color);
  margin-left: auto;
  white-space: pre-wrap;
}
.copilotKitMessage.copilotKitAssistantMessage {
  background: var(--copilot-kit-secondary-color);
  color: var(--copilot-kit-secondary-contrast-color);
  margin-right: auto;
}
.copilotKitMessage.copilotKitUserMessage
  + .copilotKitMessage.copilotKitAssistantMessage {
  margin-top: 1.5rem;
}
.copilotKitMessage.copilotKitAssistantMessage
  + .copilotKitMessage.copilotKitUserMessage {
  margin-top: 1.5rem;
}
.copilotKitCustomAssistantMessage {
  margin-top: 1.5rem;
  margin-bottom: 1.5rem;
}
.copilotKitMessage .inProgressLabel {
  margin-left: 10px;
}
.copilotKitMessages footer {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

/* src/css/window.css */
.copilotKitWindow {
  position: fixed;
  inset: 0px;
  transform-origin: bottom;
  border-color: rgb(229 231 235);
  background-color: rgb(255 255 255);
  border-radius: 0.75rem;
  box-shadow: rgba(0, 0, 0, 0.16) 0px 5px 40px;
  flex-direction: column;
  transition: opacity 100ms ease-out, transform 200ms ease-out;
  opacity: 0;
  transform: scale(0.95) translateY(20px);
  display: flex;
  pointer-events: none;
}
.copilotKitSidebar .copilotKitWindow {
  border-radius: 0;
  opacity: 1;
  transform: translateX(100%);
}
.copilotKitWindow.open {
  opacity: 1;
  transform: scale(1) translateY(0);
  pointer-events: auto;
}
.copilotKitSidebar .copilotKitWindow.open {
  transform: translateX(0);
}
@media (min-width: 640px) {
  .copilotKitWindow {
    transform-origin: bottom right;
    bottom: 5rem;
    right: 1rem;
    top: auto;
    left: auto;
    border-width: 0px;
    margin-bottom: 1rem;
    width: 24rem;
    height: 600px;
    min-height: 200px;
    max-height: calc(100% - 6rem);
  }
  .copilotKitSidebar .copilotKitWindow {
    bottom: 0;
    right: 0;
    top: auto;
    left: auto;
    width: 28rem;
    min-height: 100%;
    margin-bottom: 0;
    max-height: none;
  }
}

/* src/css/animations.css */
.copilotKitActivityDot1 {
  animation: copilotKitActivityDotsAnimation 1.05s infinite;
}
.copilotKitActivityDot2 {
  animation-delay: 0.1s;
}
.copilotKitActivityDot3 {
  animation-delay: 0.2s;
}
@keyframes copilotKitActivityDotsAnimation {
  0%,
  57.14% {
    animation-timing-function: cubic-bezier(0.33, 0.66, 0.66, 1);
    transform: translate(0);
  }
  28.57% {
    animation-timing-function: cubic-bezier(0.33, 0, 0.66, 0.33);
    transform: translateY(-6px);
  }
  100% {
    transform: translate(0);
  }
}
@keyframes copilotKitSpinAnimation {
  to {
    transform: rotate(360deg);
  }
}
@keyframes copilotKitPulseAnimation {
  50% {
    opacity: 0.5;
  }
}

/* src/css/response.css */
.copilotKitResponseButton {
  background-color: var(--copilot-kit-response-button-background-color);
  border: 1px solid var(--copilot-kit-separator-color);
  border-radius: 4px;
  color: var(--copilot-kit-response-button-color);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  height: 32px;
  line-height: 30px;
  margin: 0;
  padding: 0 16px;
  text-align: center;
  text-decoration: none;
  text-transform: none;
  white-space: nowrap;
  margin-top: 15px;
}
.copilotKitResponseButton:hover {
  filter: brightness(95%);
}
.copilotKitResponseButton span {
  margin-right: 0.5rem;
}

/* src/css/markdown.css */
.copilotKitMarkdown h1,
.copilotKitMarkdown h2,
.copilotKitMarkdown h3,
.copilotKitMarkdown h4,
.copilotKitMarkdown h5,
.copilotKitMarkdown h6 {
  font-weight: bold;
  line-height: 1.2;
}
.copilotKitMarkdown h1:not(:last-child),
.copilotKitMarkdown h2:not(:last-child),
.copilotKitMarkdown h3:not(:last-child),
.copilotKitMarkdown h4:not(:last-child),
.copilotKitMarkdown h5:not(:last-child),
.copilotKitMarkdown h6:not(:last-child) {
  margin-bottom: 1rem;
}
.copilotKitMarkdown h1 {
  font-size: 1.5em;
}
.copilotKitMarkdown h2 {
  font-size: 1.25em;
  font-weight: 600;
}
.copilotKitMarkdown h3 {
  font-size: 1.1em;
}
.copilotKitMarkdown h4 {
  font-size: 1em;
}
.copilotKitMarkdown h5 {
  font-size: 0.9em;
}
.copilotKitMarkdown h6 {
  font-size: 0.8em;
}
.copilotKitMarkdown p:not(:last-child) {
  margin-bottom: 1.25em;
}
.copilotKitMarkdown pre:not(:last-child) {
  margin-bottom: 1.25em;
}
.copilotKitMarkdown blockquote {
  border-color: rgb(142, 142, 160);
  border-left-width: 2px;
  border-left-style: solid;
  line-height: 1.2;
  padding-left: 10px;
}
.copilotKitMarkdown blockquote p {
  padding: 0.7em 0;
}
.copilotKitMarkdown ul {
  list-style-type: disc;
  padding-left: 20px;
  overflow: visible;
}
.copilotKitMarkdown li {
  list-style-type: inherit;
  list-style-position: outside;
  margin-left: 0;
  padding-left: 0;
  position: relative;
  overflow: visible;
}
.copilotKitCodeBlock {
  position: relative;
  width: 100%;
  background-color: rgb(9 9 11);
  border-radius: 0.375rem;
}
.copilotKitCodeBlockToolbar {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  background-color: rgb(39 39 42);
  padding-left: 1rem;
  padding-top: 0.09rem;
  padding-bottom: 0.09rem;
  color: rgb(228, 228, 228);
  border-top-left-radius: 0.375rem;
  border-top-right-radius: 0.375rem;
  font-family: sans-serif;
}
.copilotKitCodeBlockToolbarLanguage {
  font-size: 0.75rem;
  line-height: 1rem;
  text-transform: lowercase;
}
.copilotKitCodeBlockToolbarButtons {
  display: flex;
  align-items: center;
  margin-right: 0.25rem;
  margin-left: 0.25rem;
}
.copilotKitCodeBlockToolbarButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  font-weight: 500;
  height: 2.5rem;
  width: 2.5rem;
  padding: 3px;
  margin: 2px;
}
.copilotKitCodeBlockToolbarButton:hover {
  background-color: rgb(55, 55, 58);
}

/* src/css/suggestions.css */
.copilotKitMessages footer .suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.copilotKitMessages footer h6 {
  font-weight: 500;
  font-size: 0.7rem;
  margin-bottom: 8px;
}
.copilotKitMessages footer .suggestions .suggestion {
  padding: 8px 12px;
  font-size: 0.7rem;
  border-radius: 0.5rem;
  background: var(--copilot-kit-primary-color);
  color: var(--copilot-kit-contrast-color);
}
.copilotKitMessages footer .suggestions button {
  transition: transform 0.3s ease;
}
.copilotKitMessages footer .suggestions button:not(:disabled):hover {
  transform: scale(1.05);
}
.copilotKitMessages footer .suggestions button:disabled {
  cursor: wait;
}
.copilotKitMessages footer .suggestions button svg {
  margin-right: 6px;
}

/* src/css/panel.css */
.copilotKitChat {
  z-index: 30;
  line-height: 1.5;
  -webkit-text-size-adjust: 100%;
  -moz-tab-size: 4;
  -o-tab-size: 4;
  tab-size: 4;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif,
    "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
  font-feature-settings: normal;
  font-variation-settings: normal;
  touch-action: manipulation;
  display: flex;
  flex-direction: column;
}
.copilotKitChat svg {
  display: inline-block;
  vertical-align: middle;
}
.copilotKitChat .copilotKitMessages {
  flex-grow: 1;
}
.tooltip {
  display: none;
  position: absolute;
  background-color: white;
  border: 1px solid #ddd;
  color: #222;
  padding: 15px;
  border-radius: 5px;
  z-index: 1000;
  font-size: 13px;
  width: 350px;
}
.tooltip b {
  color: rgb(59, 130, 246);
  font-family: monospace;
}

.copilotKitInput {
  cursor: pointer;
}

.copilotKitInput input {
  flex: 1; /* Allow textarea to take up remaining space */
  outline: 2px solid transparent;
  outline-offset: 2px;
  resize: none;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  cursor: pointer;
  font-size: 0.875rem;
  line-height: 1.25rem;
  margin: 0;
  padding: 0;
  font-family: inherit;
  font-weight: inherit;
  color: var(--copilot-kit-secondary-contrast-color);
  border: 0px;
  background-color: var(--copilot-kit-background-color);
}

.copilotKitHeader:hover {
  box-shadow: 0 0 0 2px rgb(7, 201, 131);
}

.copilotKitAssistantMessage:hover {
  box-shadow: 0 0 0 2px rgb(7, 201, 131);
}

.copilotKitUserMessage:hover {
  box-shadow: 0 0 0 2px rgb(7, 201, 131);
}

.micButton:hover {
  box-shadow: 0 0 0 2px rgb(7, 201, 131);
  border-radius: 5px;
}

.sendButton:hover {
  box-shadow: 0 0 0 2px rgb(7, 201, 131);
  border-radius: 5px;
}
    `}
    </style>
  );
}

export const handleMouseMove = (e: any) => {
  const tooltip: any = document.querySelector(".tooltip");
  tooltip.style.display = "block";
  const rect = tooltip.parentElement.getBoundingClientRect();
  tooltip.style.left = `${e.clientX - rect.left + 15}px`;
  tooltip.style.top = `${e.clientY - rect.top + 15}px`;

  let element = e.target;

  while (element && element !== document.body) {
    console.log(element.classList);
    if (element.classList.contains("copilotKitHeader")) {
      tooltip.innerHTML =
        "<b>--copilot-kit-primary-color</b>: Header background color.<br/><br/><b>--copilot-kit-contrast-color</b>: Header foreground color.";
      return;
    } else if (element.classList.contains("copilotKitAssistantMessage")) {
      tooltip.innerHTML =
        "<b>--copilot-kit-secondary-color</b>: Assistant message background color.<br/><br/><b>--copilot-kit-secondary-contrast-color</b>: Assistant message foreground color.";
      return;
    } else if (element.classList.contains("copilotKitUserMessage")) {
      tooltip.innerHTML =
        "<b>--copilot-kit-primary-color</b>: User message background color.<br/><br/><b>--copilot-kit-contrast-color</b>: User message foreground color.";
      return;
    } else if (element.classList.contains("copilotKitMessages")) {
      tooltip.innerHTML =
        "<b>--copilot-kit-background-color</b>: Chat window background color.<br/><br/><b>--copilot-kit-scrollbar-color</b>: Chat window scrollbar color.<br/><br/><b>--copilot-kit-separator-color</b>: Bottom separator color.";
      return;
    } else if (element.classList.contains("micButton")) {
      tooltip.innerHTML =
        "<b>--copilot-kit-primary-color</b>: Active button color";
      return;
    } else if (element.classList.contains("sendButton")) {
      tooltip.innerHTML =
        "<b>--copilot-kit-muted-color</b>: Muted button color";
      return;
    } else if (element.classList.contains("copilotKitInput")) {
      tooltip.innerHTML =
        "<b>--copilot-kit-muted-color</b>: Placeholder color.";
      return;
    }
    element = element.parentElement;
  }

  tooltip.style.display = "none";
};

export const handleMouseLeave = (e: any) => {
  const tooltip: any = document.querySelector(".tooltip");
  tooltip.style.display = "none";
};

export const InteractiveCSSInspector = () => {
  return (
    <>
      <div className="tooltip">Close CopilotKit</div>
      <Frame className="">
        <div
          className=""
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{
            width: "384px",
            cursor: "pointer",
          }}
        >
          <div className="open">
            <div className="copilotKitHeader">
              <div>CopilotKit</div>
              <button aria-label="Close">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="1.5"
                  stroke="currentColor"
                  width={24}
                  height={24}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div className="copilotKitMessages">
              <div className="copilotKitMessage copilotKitAssistantMessage">
                Hi you! 👋 I can help you create a presentation on any topic.
              </div>
              <div className="copilotKitMessage copilotKitUserMessage">
                Hello CopilotKit!
              </div>
            </div>
            <div className="copilotKitInput">
              <input
                placeholder="Type a message..."
                style={{
                  overflow: "auto",
                  resize: "none",
                  maxHeight: 100,
                  height: 20,
                }}
                defaultValue={""}
                disabled={false}
              />
              <div className="copilotKitInputControls">
                <button className="micButton">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="1.5"
                    stroke="currentColor"
                    className="w-6 h-6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
                    />
                  </svg>
                </button>
                <button className="sendButton" disabled={false}>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    width={24}
                    height={24}
                    strokeWidth="1.5"
                    stroke="currentColor"
                    style={{}}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Frame>
    </>
  );
};

# What needs to be documented:

## CopilotKitChatProps

- instructions?: string; Custom instructions to add to the system message
  - [x] in code
  - [ ] in mintlify
- defaultOpen?: boolean; Whether the popup should be open by default
  - [x] in code
  - [ ] in mintlify
- clickOutsideToClose?: boolean; Whether the popup should close when clicking outside of it
  - [x] in code
  - [ ] in mintlify
- hitEscapeToClose?: boolean; Whether the popup should close when hitting the escape key
  - [x] in code
  - [ ] in mintlify
- hotkey?: string; The hotkey to open the popup
  - [x] in code
  - [ ] in mintlify
- icons?: CopilotKitChatIcons; Users can override icons
  - [x] in code
  - [ ] in mintlify
- labels?: CopilotKitChatLabels; Users can override labels
  - [x] in code
  - [ ] in mintlify
- Window?: React.ComponentType<WindowProps>; Users can override the Window component
  - [x] in code
  - [ ] in mintlify
- Button?: React.ComponentType<ButtonProps>; Users can override the Button component
  - [x] in code
  - [ ] in mintlify
- Header?: React.ComponentType<HeaderProps>; Users can override the Header component
  - [x] in code
  - [ ] in mintlify
- Messages?: React.ComponentType<MessagesProps>; Users can override the Messages component
  - [x] in code
  - [ ] in mintlify
- Input?: React.ComponentType<InputProps>; Users can override the Input component
  - [x] in code
  - [ ] in mintlify

## Mobile/Responsive Support

## CSS Classes

- easily change colors

```
  --copilot-kit-primary-color: rgb(59 130 246);
  --copilot-kit-contrast-color: rgb(255 255 255);
  --copilot-kit-secondary-color: rgb(243 244 246);
  --copilot-kit-secondary-contrast-color: rgb(0 0 0);
  --copilot-kit-background-color: rgb(255 255 255);
  --copilot-kit-muted-color: rgb(106 106 106);
  --copilot-kit-separator-color: rgba(0, 0, 0, 0.08);
  --copilot-kit-scrollbar-color: rgba(0, 0, 0, 0.2);
```

- easily change the appearance and animation of different elements, for example

make the button square:

```
.copilotKitButton {
  border-radius: 0;
}
```

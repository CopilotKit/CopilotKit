# What needs to be documented:

## CopilotKitPopupProps

- instructions?: string; Custom instructions to add to the system message
- headers?: Record<string, string> | Headers; Headers to add to the request
- body?: object; Body to add to the request. Can override model etc.
- defaultOpen?: boolean; Whether the popup should be open by default
- clickOutsideToClose?: boolean; Whether the popup should close when clicking outside of it
- hitEscapeToClose?: boolean; Whether the popup should close when hitting the escape key
- hotkey?: string; The hotkey to open the popup
- icons?: CopilotKitChatIcons; Users can override icons
- labels?: CopilotKitChatLabels; Users can override labels
- Window?: React.ComponentType<WindowProps>; Users can override the Window component
- Button?: React.ComponentType<ButtonProps>; Users can override the Button component
- Header?: React.ComponentType<HeaderProps>; Users can override the Header component
- Messages?: React.ComponentType<MessagesProps>; Users can override the Messages component
- Input?: React.ComponentType<InputProps>; Users can override the Input component

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

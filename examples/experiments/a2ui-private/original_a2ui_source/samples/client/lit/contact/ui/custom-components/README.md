# A2UI custom component integration guide

This guide details how to create, register, and use a custom component in the A2UI client.

## Create the component

Create a new Lit component file in `lib/src/0.8/ui/custom-components/`.
Example: `my-component.ts`

```typescript
import { html, css } from 'lit';
import { property } from 'lit/decorators.js';

import { Root } from '../root.js';

export class MyComponent extends Root {
  @property() accessor myProp: string = 'Default';

  static styles = [
    ...Root.styles, // Inherit base styles
    css`
      :host {
        display: block;
        padding: 16px;
        border: 1px solid #ccc;
      }
    `
  ];

  render() {
    return html`
      <div>
        <h2>My Custom Component</h2>
        <p>Prop value: ${this.myProp}</p>
      </div>
    `;
  }
}
```

## Register the component

Update `lib/src/0.8/ui/custom-components/index.ts` to register your new component.
You must pass the desired tag name as the third argument.

```typescript
import { REGISTRY } from '../component-registry.js';
import { MyComponent } from './my-component.js'; // Import your component

export function registerCustomComponents() {
  // Register with explicit tag name
  REGISTRY.register('MyComponent', MyComponent, 'my-component');
}

export { MyComponent }; // Export for type usage if needed
```

## Define the schema (server-side)

Create a JSON schema for your component properties. This will be used by the server to validate messages.
Example: `lib/my_component_schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "type": { "const": "object" },
    "properties": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "myProp": {
          "type": "string",
          "description": "A sample property."
        }
      },
      "required": ["myProp"]
    }
  },
  "required": ["type", "properties"]
}
```

## Use in client application

In your client application (e.g., `contact` sample), ensure you import and call the registration function.

```typescript
import { registerCustomComponents } from '@a2ui/web-lib/ui';

// Call this once at startup
registerCustomComponents();
```

## Overriding standard components

You can replace standard A2UI components (like `TextField`, `Video`, `Button`) with your own custom implementations.

### Steps to override

1.  **Create your component** extending `Root` (just like a custom component).

2.  **Ensure it accepts the standard properties** for that component type (e.g., `label` and `text` for `TextField`).

3.  **Register it** using the **standard type name** (e.g., `"TextField"`).

    ```typescript
    // 1. Define your override
    class MyPremiumTextField extends Root {
      @property() accessor label = '';
      @property() accessor text = '';

      static styles = [...Root.styles, css`/* your premium styles */`];

      render() {
        return html`
          <div class="premium-field">
            <label>${this.label}</label>
            <input .value="${this.text}">
          </div>
        `;
      }
    }

    // 2. Register with the STANDARD type name
    import { REGISTRY } from '@a2ui/web-lib/ui';
    REGISTRY.register('TextField', MyPremiumTextField, 'my-premium-textfield');
    ```

**Result:**
When the server sends a `TextField` component, the client will now render `<my-premium-textfield>` instead of the default `<a2ui-textfield>`.

## Verify

You can verify the component by creating a simple HTML test file or by sending a server message with the new component type.

**Server message example:**
```json
{
  "surfaceId": "main",
  "component": {
    "type": "MyComponent",
    "id": "comp-1",
    "properties": {
      "myProp": "Hello World"
    }
  }
}
```

## Troubleshooting

-   **`NotSupportedError`**: If you see "constructor has already been used", ensure you **removed** the `@customElement` decorator from your component class.
-   **Component not rendering**: Check if `registerCustomComponents()` is actually called. Verify the tag name in the DOM matches what you registered (e.g., `<my-component>` vs `<a2ui-custom-mycomponent>`).
-   **Styles missing**: Ensure `static styles` includes `...Root.styles`.

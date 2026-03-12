import { REGISTRY, Root } from '@a2ui/web-lib/ui';
import { html, css } from 'lit';
import { property } from 'lit/decorators.js';
// 1. Define the override
import { PremiumTextField } from '../premium-text-field.js';

// 2. Register it as "TextField"
REGISTRY.register('TextField', PremiumTextField, 'premium-text-field');
console.log('Registered PremiumTextField override');

// 3. Render a standard TextField component node
const container = document.getElementById('app');
if (container) {
  const root = document.createElement('a2ui-root') as Root;

  const textFieldComponent = {
    type: 'TextField',
    id: 'tf-1',
    properties: {
      label: 'Enter your name',
      text: 'John Doe'
    }
  };

  // Root renders its *children*, so we must pass the component as a child.
  root.childComponents = [textFieldComponent];

  root.enableCustomElements = true; // Enable the feature
  container.appendChild(root);
}

import type { ComponentInstance } from '@copilotkitnext/a2ui-renderer';

export interface ComponentProp {
  name: string;
  description: string;
  type: string;
  values?: string[];
  default?: string;
}

export interface PreviewConfig {
  root: string;
  components: ComponentInstance[];
  data?: Record<string, unknown>;
}

export interface ComponentDoc {
  name: string;
  description: string;
  usage: string;
  props: ComponentProp[];
  preview?: PreviewConfig;
}

export interface ComponentCategory {
  name: string;
  components: ComponentDoc[];
}

export const COMPONENTS_DATA: ComponentCategory[] = [
  {
    name: 'Layout',
    components: [
      {
        name: 'Row',
        description: 'Horizontal flex container that arranges children in a row with configurable alignment and distribution.',
        usage: `{
  "id": "row-1",
  "component": {
    "Row": {
      "alignment": "center",
      "distribution": "spaceBetween",
      "children": {
        "explicitList": ["child-1", "child-2"]
      }
    }
  }
}`,
        props: [
          {
            name: 'children',
            description: 'Child components to render inside the row. Can be an explicit list of component IDs or a template for dynamic rendering.',
            type: 'ComponentArrayReference',
          },
          {
            name: 'alignment',
            description: 'Vertical alignment of children within the row.',
            type: 'enum',
            values: ['start', 'center', 'end', 'stretch'],
            default: 'stretch',
          },
          {
            name: 'distribution',
            description: 'Horizontal distribution of children along the row.',
            type: 'enum',
            values: ['start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly'],
            default: 'start',
          },
        ],
        preview: {
          root: 'row-1',
          components: [
            {
              id: 'row-1',
              component: {
                Row: {
                  alignment: 'center',
                  distribution: 'spaceBetween',
                  children: { explicitList: ['text-1', 'text-2', 'text-3'] },
                },
              },
            },
            {
              id: 'text-1',
              component: { Text: { text: { literalString: 'Left' }, usageHint: 'body' } },
            },
            {
              id: 'text-2',
              component: { Text: { text: { literalString: 'Center' }, usageHint: 'body' } },
            },
            {
              id: 'text-3',
              component: { Text: { text: { literalString: 'Right' }, usageHint: 'body' } },
            },
          ],
        },
      },
      {
        name: 'Column',
        description: 'Vertical flex container that arranges children in a column with configurable alignment and distribution.',
        usage: `{
  "id": "column-1",
  "component": {
    "Column": {
      "alignment": "stretch",
      "distribution": "start",
      "children": {
        "explicitList": ["header", "content", "footer"]
      }
    }
  }
}`,
        props: [
          {
            name: 'children',
            description: 'Child components to render inside the column. Can be an explicit list of component IDs or a template for dynamic rendering.',
            type: 'ComponentArrayReference',
          },
          {
            name: 'alignment',
            description: 'Horizontal alignment of children within the column.',
            type: 'enum',
            values: ['start', 'center', 'end', 'stretch'],
            default: 'stretch',
          },
          {
            name: 'distribution',
            description: 'Vertical distribution of children along the column.',
            type: 'enum',
            values: ['start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly'],
            default: 'start',
          },
        ],
        preview: {
          root: 'column-1',
          components: [
            {
              id: 'column-1',
              component: {
                Column: {
                  alignment: 'center',
                  distribution: 'start',
                  children: { explicitList: ['text-1', 'text-2', 'text-3'] },
                },
              },
            },
            {
              id: 'text-1',
              component: { Text: { text: { literalString: 'Header' }, usageHint: 'h3' } },
            },
            {
              id: 'text-2',
              component: { Text: { text: { literalString: 'Content goes here' }, usageHint: 'body' } },
            },
            {
              id: 'text-3',
              component: { Text: { text: { literalString: 'Footer' }, usageHint: 'caption' } },
            },
          ],
        },
      },
      {
        name: 'List',
        description: 'Container for rendering lists of items, supporting both vertical and horizontal layouts.',
        usage: `{
  "id": "list-1",
  "component": {
    "List": {
      "direction": "vertical",
      "children": {
        "template": {
          "componentId": "list-item",
          "dataBinding": "/items"
        }
      }
    }
  }
}`,
        props: [
          {
            name: 'children',
            description: 'Child components or template for list items. Use template with dataBinding to render items from data.',
            type: 'ComponentArrayReference',
          },
          {
            name: 'direction',
            description: 'Layout direction of list items.',
            type: 'enum',
            values: ['vertical', 'horizontal'],
            default: 'vertical',
          },
        ],
        preview: {
          root: 'list-1',
          components: [
            {
              id: 'list-1',
              component: {
                List: {
                  direction: 'vertical',
                  children: { explicitList: ['item-1', 'item-2', 'item-3'] },
                },
              },
            },
            {
              id: 'item-1',
              component: { Text: { text: { literalString: '• First item' }, usageHint: 'body' } },
            },
            {
              id: 'item-2',
              component: { Text: { text: { literalString: '• Second item' }, usageHint: 'body' } },
            },
            {
              id: 'item-3',
              component: { Text: { text: { literalString: '• Third item' }, usageHint: 'body' } },
            },
          ],
        },
      },
      {
        name: 'Card',
        description: 'A styled container that provides card-like appearance with elevation and padding.',
        usage: `{
  "id": "card-1",
  "component": {
    "Card": {
      "child": "card-content"
    }
  }
}`,
        props: [
          {
            name: 'child',
            description: 'The component ID to render as the card content.',
            type: 'string',
          },
        ],
        preview: {
          root: 'card-1',
          components: [
            {
              id: 'card-1',
              component: {
                Card: {
                  child: 'card-content',
                },
              },
            },
            {
              id: 'card-content',
              component: {
                Column: {
                  children: { explicitList: ['card-title', 'card-body'] },
                },
              },
            },
            {
              id: 'card-title',
              component: { Text: { text: { literalString: 'Card Title' }, usageHint: 'h4' } },
            },
            {
              id: 'card-body',
              component: { Text: { text: { literalString: 'This is the card content with some descriptive text.' }, usageHint: 'body' } },
            },
          ],
        },
      },
    ],
  },
  {
    name: 'Content',
    components: [
      {
        name: 'Text',
        description: 'Display text content with semantic styling hints. Supports markdown rendering and data binding.',
        usage: `{
  "id": "text-1",
  "component": {
    "Text": {
      "text": { "literalString": "Hello, World!" },
      "usageHint": "body"
    }
  }
}`,
        props: [
          {
            name: 'text',
            description: 'The text content to display. Can be a literal string or a path binding to data.',
            type: 'StringValue',
          },
          {
            name: 'usageHint',
            description: 'Semantic hint for text styling. Determines font size, weight, and other typographic properties.',
            type: 'enum',
            values: ['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'],
          },
        ],
        preview: {
          root: 'text-container',
          components: [
            {
              id: 'text-container',
              component: {
                Column: {
                  children: { explicitList: ['text-h1', 'text-h2', 'text-h3', 'text-body', 'text-caption'] },
                },
              },
            },
            {
              id: 'text-h1',
              component: { Text: { text: { literalString: 'Heading 1' }, usageHint: 'h1' } },
            },
            {
              id: 'text-h2',
              component: { Text: { text: { literalString: 'Heading 2' }, usageHint: 'h2' } },
            },
            {
              id: 'text-h3',
              component: { Text: { text: { literalString: 'Heading 3' }, usageHint: 'h3' } },
            },
            {
              id: 'text-body',
              component: { Text: { text: { literalString: 'Body text for paragraphs and content.' }, usageHint: 'body' } },
            },
            {
              id: 'text-caption',
              component: { Text: { text: { literalString: 'Caption text for labels and hints' }, usageHint: 'caption' } },
            },
          ],
        },
      },
      {
        name: 'Image',
        description: 'Display images with configurable sizing hints and object-fit behavior.',
        usage: `{
  "id": "image-1",
  "component": {
    "Image": {
      "url": { "literalString": "https://example.com/photo.jpg" },
      "usageHint": "mediumFeature",
      "fit": "cover"
    }
  }
}`,
        props: [
          {
            name: 'url',
            description: 'The image URL. Can be a literal string or a path binding to data.',
            type: 'StringValue',
          },
          {
            name: 'usageHint',
            description: 'Semantic hint for image sizing. Affects the rendered dimensions.',
            type: 'enum',
            values: ['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header'],
          },
          {
            name: 'fit',
            description: 'CSS object-fit value controlling how the image fills its container.',
            type: 'enum',
            values: ['contain', 'cover', 'fill', 'none', 'scale-down'],
            default: 'fill',
          },
        ],
        preview: {
          root: 'image-1',
          components: [
            {
              id: 'image-1',
              component: {
                Image: {
                  url: { literalString: 'https://picsum.photos/200/150' },
                  usageHint: 'mediumFeature',
                  fit: 'cover',
                },
              },
            },
          ],
        },
      },
      {
        name: 'Icon',
        description: 'Display Material Icons by name. Icons are rendered using the Google Icon font.',
        usage: `{
  "id": "icon-1",
  "component": {
    "Icon": {
      "name": { "literalString": "check_circle" }
    }
  }
}`,
        props: [
          {
            name: 'name',
            description: 'The Material Icon name (e.g., "check_circle", "home", "settings"). Uses snake_case naming.',
            type: 'StringValue',
          },
        ],
        preview: {
          root: 'icon-row',
          components: [
            {
              id: 'icon-row',
              component: {
                Row: {
                  distribution: 'start',
                  alignment: 'center',
                  children: { explicitList: ['icon-1', 'icon-2', 'icon-3', 'icon-4', 'icon-5'] },
                },
              },
            },
            {
              id: 'icon-1',
              component: { Icon: { name: { literalString: 'home' } } },
            },
            {
              id: 'icon-2',
              component: { Icon: { name: { literalString: 'settings' } } },
            },
            {
              id: 'icon-3',
              component: { Icon: { name: { literalString: 'check_circle' } } },
            },
            {
              id: 'icon-4',
              component: { Icon: { name: { literalString: 'favorite' } } },
            },
            {
              id: 'icon-5',
              component: { Icon: { name: { literalString: 'star' } } },
            },
          ],
        },
      },
      {
        name: 'Video',
        description: 'Embed video content with native HTML5 video player controls.',
        usage: `{
  "id": "video-1",
  "component": {
    "Video": {
      "url": { "literalString": "https://example.com/video.mp4" }
    }
  }
}`,
        props: [
          {
            name: 'url',
            description: 'The video URL. Can be a literal string or a path binding to data.',
            type: 'StringValue',
          },
        ],
        preview: {
          root: 'video-1',
          components: [
            {
              id: 'video-1',
              component: {
                Video: {
                  url: { literalString: 'https://www.w3schools.com/html/mov_bbb.mp4' },
                },
              },
            },
          ],
        },
      },
      {
        name: 'AudioPlayer',
        description: 'Embed audio content with native HTML5 audio player controls.',
        usage: `{
  "id": "audio-1",
  "component": {
    "AudioPlayer": {
      "url": { "literalString": "https://example.com/audio.mp3" },
      "description": { "literalString": "Episode 1: Introduction" }
    }
  }
}`,
        props: [
          {
            name: 'url',
            description: 'The audio URL. Can be a literal string or a path binding to data.',
            type: 'StringValue',
          },
          {
            name: 'description',
            description: 'Optional label or title for the audio content.',
            type: 'StringValue',
          },
        ],
        preview: {
          root: 'audio-card',
          components: [
            {
              id: 'audio-card',
              component: {
                Card: {
                  child: 'audio-1',
                },
              },
            },
            {
              id: 'audio-1',
              component: {
                AudioPlayer: {
                  url: { literalString: 'https://www.w3schools.com/html/horse.mp3' },
                },
              },
            },
          ],
        },
      },
    ],
  },
  {
    name: 'Input',
    components: [
      {
        name: 'TextField',
        description: 'Text input field with label, validation, and multiple input types.',
        usage: `{
  "id": "textfield-1",
  "component": {
    "TextField": {
      "text": { "path": "/user/name" },
      "label": { "literalString": "Your name" },
      "type": "shortText"
    }
  }
}`,
        props: [
          {
            name: 'text',
            description: 'The current input value. Typically bound to a data path for two-way binding.',
            type: 'StringValue',
          },
          {
            name: 'label',
            description: 'Placeholder or label text displayed in the field.',
            type: 'StringValue',
          },
          {
            name: 'type',
            description: 'The type of input field, affecting keyboard and validation behavior.',
            type: 'enum',
            values: ['shortText', 'number', 'date', 'longText'],
          },
          {
            name: 'validationRegexp',
            description: 'Optional regex pattern to validate input.',
            type: 'string',
          },
        ],
        preview: {
          root: 'textfield-1',
          components: [
            {
              id: 'textfield-1',
              component: {
                TextField: {
                  text: { path: '/name' },
                  label: { literalString: 'Enter your name' },
                  type: 'shortText',
                },
              },
            },
          ],
          data: { name: '' },
        },
      },
      {
        name: 'CheckBox',
        description: 'Boolean toggle input with an associated label.',
        usage: `{
  "id": "checkbox-1",
  "component": {
    "CheckBox": {
      "label": { "literalString": "I agree to the terms" },
      "value": { "path": "/form/agreed" }
    }
  }
}`,
        props: [
          {
            name: 'label',
            description: 'Text label displayed next to the checkbox.',
            type: 'StringValue',
          },
          {
            name: 'value',
            description: 'The checked state. Typically bound to a data path for two-way binding.',
            type: 'BooleanValue',
          },
        ],
        preview: {
          root: 'checkbox-1',
          components: [
            {
              id: 'checkbox-1',
              component: {
                CheckBox: {
                  label: { literalString: 'I agree to the terms and conditions' },
                  value: { path: '/agreed' },
                },
              },
            },
          ],
          data: { agreed: false },
        },
      },
      {
        name: 'Slider',
        description: 'Numeric range input with configurable min/max values.',
        usage: `{
  "id": "slider-1",
  "component": {
    "Slider": {
      "value": { "path": "/settings/volume" },
      "minValue": 0,
      "maxValue": 100
    }
  }
}`,
        props: [
          {
            name: 'value',
            description: 'The current slider value. Typically bound to a data path for two-way binding.',
            type: 'NumberValue',
          },
          {
            name: 'minValue',
            description: 'Minimum allowed value.',
            type: 'number',
          },
          {
            name: 'maxValue',
            description: 'Maximum allowed value.',
            type: 'number',
          },
        ],
        preview: {
          root: 'slider-1',
          components: [
            {
              id: 'slider-1',
              component: {
                Slider: {
                  value: { path: '/volume' },
                  minValue: 0,
                  maxValue: 100,
                },
              },
            },
          ],
          data: { volume: 50 },
        },
      },
      {
        name: 'DateTimeInput',
        description: 'Date and/or time picker with configurable format output.',
        usage: `{
  "id": "datetime-1",
  "component": {
    "DateTimeInput": {
      "value": { "path": "/event/startDate" },
      "enableDate": true,
      "enableTime": true,
      "outputFormat": "YYYY-MM-DD HH:mm"
    }
  }
}`,
        props: [
          {
            name: 'value',
            description: 'The current date/time value in ISO format. Typically bound to a data path.',
            type: 'StringValue',
          },
          {
            name: 'enableDate',
            description: 'Whether to show the date picker.',
            type: 'boolean',
            default: 'true',
          },
          {
            name: 'enableTime',
            description: 'Whether to show the time picker.',
            type: 'boolean',
            default: 'true',
          },
          {
            name: 'outputFormat',
            description: 'Format string for the output value (e.g., "YYYY-MM-DD").',
            type: 'string',
          },
        ],
        preview: {
          root: 'datetime-1',
          components: [
            {
              id: 'datetime-1',
              component: {
                DateTimeInput: {
                  value: { path: '/date' },
                  enableDate: true,
                  enableTime: false,
                },
              },
            },
          ],
          data: { date: '2025-01-15' },
        },
      },
      {
        name: 'MultipleChoice',
        description: 'Dropdown or select input for choosing from predefined options.',
        usage: `{
  "id": "select-1",
  "component": {
    "MultipleChoice": {
      "selections": { "path": "/form/country" },
      "options": [
        { "label": { "literalString": "United States" }, "value": "US" },
        { "label": { "literalString": "Canada" }, "value": "CA" },
        { "label": { "literalString": "Mexico" }, "value": "MX" }
      ],
      "maxAllowedSelections": 1
    }
  }
}`,
        props: [
          {
            name: 'selections',
            description: 'Currently selected value(s). Bound to a data path for two-way binding.',
            type: 'StringArrayValue',
          },
          {
            name: 'options',
            description: 'Array of available options with label and value.',
            type: 'array',
          },
          {
            name: 'maxAllowedSelections',
            description: 'Maximum number of selections allowed. Use 1 for single-select behavior.',
            type: 'number',
          },
        ],
        preview: {
          root: 'select-1',
          components: [
            {
              id: 'select-1',
              component: {
                MultipleChoice: {
                  selections: { path: '/country' },
                  options: [
                    { label: { literalString: 'United States' }, value: 'US' },
                    { label: { literalString: 'Canada' }, value: 'CA' },
                    { label: { literalString: 'Mexico' }, value: 'MX' },
                  ],
                  maxAllowedSelections: 1,
                },
              },
            },
          ],
          data: { country: ['US'] },
        },
      },
    ],
  },
  {
    name: 'Navigation',
    components: [
      {
        name: 'Button',
        description: 'Interactive button that triggers an action when clicked. Contains a child component for its content.',
        usage: `{
  "id": "button-1",
  "component": {
    "Button": {
      "child": "button-label",
      "action": {
        "name": "submit",
        "context": [
          { "key": "formId", "value": { "literalString": "contact-form" } }
        ]
      }
    }
  }
}`,
        props: [
          {
            name: 'child',
            description: 'Component ID to render as the button content (typically a Text or Row with Icon + Text).',
            type: 'string',
          },
          {
            name: 'action',
            description: 'Action configuration dispatched when the button is clicked.',
            type: 'Action',
          },
        ],
        preview: {
          root: 'button-row',
          components: [
            {
              id: 'button-row',
              component: {
                Row: {
                  distribution: 'start',
                  alignment: 'center',
                  children: { explicitList: ['button-1', 'button-2'] },
                },
              },
            },
            {
              id: 'button-1',
              component: {
                Button: {
                  child: 'button-label-1',
                  action: { name: 'primary-action' },
                },
              },
            },
            {
              id: 'button-label-1',
              component: { Text: { text: { literalString: 'Submit' }, usageHint: 'body' } },
            },
            {
              id: 'button-2',
              component: {
                Button: {
                  child: 'button-label-2',
                  action: { name: 'secondary-action' },
                },
              },
            },
            {
              id: 'button-label-2',
              component: {
                Row: {
                  alignment: 'center',
                  children: { explicitList: ['btn-icon', 'btn-text'] },
                },
              },
            },
            {
              id: 'btn-icon',
              component: { Icon: { name: { literalString: 'add' } } },
            },
            {
              id: 'btn-text',
              component: { Text: { text: { literalString: 'Add Item' }, usageHint: 'body' } },
            },
          ],
        },
      },
      {
        name: 'Tabs',
        description: 'Tab navigation component with multiple panels. Each tab has a title and associated content.',
        usage: `{
  "id": "tabs-1",
  "component": {
    "Tabs": {
      "tabItems": [
        { "title": { "literalString": "Overview" }, "child": "tab-overview" },
        { "title": { "literalString": "Details" }, "child": "tab-details" },
        { "title": { "literalString": "Reviews" }, "child": "tab-reviews" }
      ]
    }
  }
}`,
        props: [
          {
            name: 'tabItems',
            description: 'Array of tab configurations, each with a title and child component ID.',
            type: 'array',
          },
        ],
        preview: {
          root: 'tabs-1',
          components: [
            {
              id: 'tabs-1',
              component: {
                Tabs: {
                  tabItems: [
                    { title: { literalString: 'Overview' }, child: 'tab-1' },
                    { title: { literalString: 'Details' }, child: 'tab-2' },
                    { title: { literalString: 'Reviews' }, child: 'tab-3' },
                  ],
                },
              },
            },
            {
              id: 'tab-1',
              component: { Text: { text: { literalString: 'This is the overview content.' }, usageHint: 'body' } },
            },
            {
              id: 'tab-2',
              component: { Text: { text: { literalString: 'Here are the details.' }, usageHint: 'body' } },
            },
            {
              id: 'tab-3',
              component: { Text: { text: { literalString: 'User reviews go here.' }, usageHint: 'body' } },
            },
          ],
        },
      },
      {
        name: 'Modal',
        description: 'Dialog/popup component with a trigger element and content panel.',
        usage: `{
  "id": "modal-1",
  "component": {
    "Modal": {
      "entryPointChild": "open-modal-button",
      "contentChild": "modal-content"
    }
  }
}`,
        props: [
          {
            name: 'entryPointChild',
            description: 'Component ID of the element that triggers the modal (typically a Button).',
            type: 'string',
          },
          {
            name: 'contentChild',
            description: 'Component ID of the content to display inside the modal.',
            type: 'string',
          },
        ],
        preview: {
          root: 'modal-1',
          components: [
            {
              id: 'modal-1',
              component: {
                Modal: {
                  entryPointChild: 'modal-trigger',
                  contentChild: 'modal-content',
                },
              },
            },
            {
              id: 'modal-trigger',
              component: {
                Button: {
                  child: 'modal-trigger-text',
                  action: { name: 'open-modal' },
                },
              },
            },
            {
              id: 'modal-trigger-text',
              component: { Text: { text: { literalString: 'Open Modal' }, usageHint: 'body' } },
            },
            {
              id: 'modal-content',
              component: {
                Column: {
                  children: { explicitList: ['modal-title', 'modal-body'] },
                },
              },
            },
            {
              id: 'modal-title',
              component: { Text: { text: { literalString: 'Modal Title' }, usageHint: 'h3' } },
            },
            {
              id: 'modal-body',
              component: { Text: { text: { literalString: 'This is the modal content. Click outside or the X to close.' }, usageHint: 'body' } },
            },
          ],
        },
      },
    ],
  },
  {
    name: 'Decoration',
    components: [
      {
        name: 'Divider',
        description: 'Visual separator line between content sections.',
        usage: `{
  "id": "divider-1",
  "component": {
    "Divider": {
      "axis": "horizontal",
      "thickness": 1
    }
  }
}`,
        props: [
          {
            name: 'axis',
            description: 'Orientation of the divider line.',
            type: 'enum',
            values: ['horizontal', 'vertical'],
          },
          {
            name: 'color',
            description: 'Color of the divider (hex code or semantic name).',
            type: 'string',
          },
          {
            name: 'thickness',
            description: 'Thickness of the divider line in pixels.',
            type: 'number',
          },
        ],
        preview: {
          root: 'divider-demo',
          components: [
            {
              id: 'divider-demo',
              component: {
                Column: {
                  children: { explicitList: ['text-above', 'divider-1', 'text-below'] },
                },
              },
            },
            {
              id: 'text-above',
              component: { Text: { text: { literalString: 'Content above' }, usageHint: 'body' } },
            },
            {
              id: 'divider-1',
              component: {
                Divider: {
                  axis: 'horizontal',
                  thickness: 1,
                },
              },
            },
            {
              id: 'text-below',
              component: { Text: { text: { literalString: 'Content below' }, usageHint: 'body' } },
            },
          ],
        },
      },
    ],
  },
];

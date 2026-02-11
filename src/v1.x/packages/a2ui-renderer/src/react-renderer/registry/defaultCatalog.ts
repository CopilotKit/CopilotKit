import { ComponentRegistry } from './ComponentRegistry';

// Content components
import { Text } from '../components/content/Text';
import { Image } from '../components/content/Image';
import { Icon } from '../components/content/Icon';
import { Divider } from '../components/content/Divider';
import { Video } from '../components/content/Video';
import { AudioPlayer } from '../components/content/AudioPlayer';

// Layout components
import { Row } from '../components/layout/Row';
import { Column } from '../components/layout/Column';
import { List } from '../components/layout/List';
import { Card } from '../components/layout/Card';
import { Tabs } from '../components/layout/Tabs';
import { Modal } from '../components/layout/Modal';

// Interactive components
import { Button } from '../components/interactive/Button';
import { TextField } from '../components/interactive/TextField';
import { CheckBox } from '../components/interactive/CheckBox';
import { Slider } from '../components/interactive/Slider';
import { DateTimeInput } from '../components/interactive/DateTimeInput';
import { MultipleChoice } from '../components/interactive/MultipleChoice';

/**
 * Registers all standard A2UI components in the registry.
 *
 * @param registry - The component registry to populate
 */
export function registerDefaultCatalog(registry: ComponentRegistry): void {
  // Content components (small, load immediately)
  registry.register('Text', { component: Text });
  registry.register('Image', { component: Image });
  registry.register('Icon', { component: Icon });
  registry.register('Divider', { component: Divider });
  registry.register('Video', { component: Video });
  registry.register('AudioPlayer', { component: AudioPlayer });

  // Layout components
  registry.register('Row', { component: Row });
  registry.register('Column', { component: Column });
  registry.register('List', { component: List });
  registry.register('Card', { component: Card });

  // Additional layout components
  registry.register('Tabs', { component: Tabs });
  registry.register('Modal', { component: Modal });

  // Interactive components
  registry.register('Button', { component: Button });
  registry.register('TextField', { component: TextField });
  registry.register('CheckBox', { component: CheckBox });
  registry.register('Slider', { component: Slider });
  registry.register('DateTimeInput', { component: DateTimeInput });
  registry.register('MultipleChoice', { component: MultipleChoice });
}

/**
 * Initialize the default catalog in the singleton registry.
 * Call this once at app startup.
 */
export function initializeDefaultCatalog(): void {
  registerDefaultCatalog(ComponentRegistry.getInstance());
}

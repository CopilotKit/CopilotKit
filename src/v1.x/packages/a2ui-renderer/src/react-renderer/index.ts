// Core components and provider
export {
  A2UIProvider,
  useA2UIActions,
  useA2UIState,
  useA2UIContext,
  useA2UIStore, // @deprecated - use useA2UIContext
  useA2UIStoreSelector, // @deprecated - use useA2UIContext or useA2UI
} from './core/A2UIProvider';
export type { A2UIProviderProps } from './core/A2UIProvider';
export { A2UIRenderer } from './core/A2UIRenderer';
export type { A2UIRendererProps } from './core/A2UIRenderer';
export { A2UIViewer } from './core/A2UIViewer';
export type { A2UIViewerProps, ComponentInstance, A2UIActionEvent } from './core/A2UIViewer';
export { ComponentNode } from './core/ComponentNode';

// Hooks
export { useA2UI } from './hooks/useA2UI';
export type { UseA2UIResult } from './hooks/useA2UI';
export { useA2UIComponent } from './hooks/useA2UIComponent';
export type { UseA2UIComponentResult } from './hooks/useA2UIComponent';

// Registry
export { ComponentRegistry } from './registry/ComponentRegistry';
export { registerDefaultCatalog, initializeDefaultCatalog } from './registry/defaultCatalog';

// Theme
export { ThemeProvider, useTheme, useThemeOptional } from './theme/ThemeContext';
export { litTheme, defaultTheme } from './theme/litTheme';

// Utilities
export { cn, classMapToString, stylesToObject } from './lib/utils';

// Types - re-export from types
export type {
  Types,
  Primitives,
  AnyComponentNode,
  Surface,
  SurfaceID,
  Theme,
  ServerToClientMessage,
  A2UIClientEventMessage,
  Action,
  DataValue,
  MessageProcessor,
  StringValue,
  NumberValue,
  BooleanValue,
  A2UIComponentProps,
  ComponentRegistration,
  ComponentLoader,
  OnActionCallback,
  A2UIProviderConfig,
} from './types';

// Content components
export { Text } from './components/content/Text';
export { Image } from './components/content/Image';
export { Icon } from './components/content/Icon';
export { Divider } from './components/content/Divider';
export { Video } from './components/content/Video';
export { AudioPlayer } from './components/content/AudioPlayer';

// Layout components
export { Row } from './components/layout/Row';
export { Column } from './components/layout/Column';
export { List } from './components/layout/List';
export { Card } from './components/layout/Card';
export { Tabs } from './components/layout/Tabs';
export { Modal } from './components/layout/Modal';

// Interactive components
export { Button } from './components/interactive/Button';
export { TextField } from './components/interactive/TextField';
export { CheckBox } from './components/interactive/CheckBox';
export { Slider } from './components/interactive/Slider';
export { DateTimeInput } from './components/interactive/DateTimeInput';
export { MultipleChoice } from './components/interactive/MultipleChoice';

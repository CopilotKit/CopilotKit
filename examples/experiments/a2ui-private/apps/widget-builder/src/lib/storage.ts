import localforage from 'localforage';
import { Widget } from '@/types/widget';

const WIDGETS_KEY = 'widgets';

localforage.config({
  name: 'widget-builder',
  storeName: 'widgets',
});

export async function getWidgets(): Promise<Widget[]> {
  const widgets = await localforage.getItem<Widget[]>(WIDGETS_KEY);
  return widgets || [];
}

export async function saveWidget(widget: Widget): Promise<void> {
  const widgets = await getWidgets();
  const index = widgets.findIndex(w => w.id === widget.id);
  if (index >= 0) {
    widgets[index] = widget;
  } else {
    widgets.push(widget);
  }
  await localforage.setItem(WIDGETS_KEY, widgets);
}

export async function deleteWidget(id: string): Promise<void> {
  const widgets = await getWidgets();
  await localforage.setItem(WIDGETS_KEY, widgets.filter(w => w.id !== id));
}

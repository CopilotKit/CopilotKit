import { Widget } from '@/types/widget';

export const NOTIFICATION_PERMISSION_WIDGET: Widget = {
  id: 'gallery-notification-permission',
  name: 'Notification',
  description: 'Permission request dialog for notifications',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  root: 'root',
  components: [
    {
      id: 'root',
      component: {
        Card: {
          child: 'main-column',
        },
      },
    },
    {
      id: 'main-column',
      component: {
        Column: {
          children: { explicitList: ['icon', 'title', 'description', 'actions'] },
          gap: 'medium',
          alignment: 'center',
        },
      },
    },
    {
      id: 'icon',
      component: {
        Icon: {
          name: { path: '/icon' },
        },
      },
    },
    {
      id: 'title',
      component: {
        Text: {
          text: { path: '/title' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'description',
      component: {
        Text: {
          text: { path: '/description' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'actions',
      component: {
        Row: {
          children: { explicitList: ['yes-btn', 'no-btn'] },
          gap: 'medium',
          distribution: 'center',
        },
      },
    },
    {
      id: 'yes-btn-text',
      component: {
        Text: {
          text: { literalString: 'Yes' },
        },
      },
    },
    {
      id: 'yes-btn',
      component: {
        Button: {
          child: 'yes-btn-text',
          action: 'accept',
        },
      },
    },
    {
      id: 'no-btn-text',
      component: {
        Text: {
          text: { literalString: 'No' },
        },
      },
    },
    {
      id: 'no-btn',
      component: {
        Button: {
          child: 'no-btn-text',
          action: 'decline',
        },
      },
    },
  ],
  dataStates: [
    {
      name: 'Default',
      data: {
        icon: 'check',
        title: 'Enable notification',
        description: 'Get alerts for order status changes',
      },
    },
  ],
};

export const NOTIFICATION_PERMISSION_GALLERY = {
  widget: NOTIFICATION_PERMISSION_WIDGET,
  height: 180,
};

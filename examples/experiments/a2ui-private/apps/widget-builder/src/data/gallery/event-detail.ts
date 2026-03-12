import { Widget } from '@/types/widget';

// 17. Event Detail Card
export const EVENT_DETAIL_WIDGET: Widget = {
  id: 'gallery-event-detail',
  name: 'Event Detail Card',
  description: 'Detailed event view with time, location, and RSVP',
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
          children: { explicitList: ['title', 'time-row', 'location-row', 'description', 'divider', 'actions'] },
          gap: 'medium',
        },
      },
    },
    {
      id: 'title',
      component: {
        Text: {
          text: { path: '/title' },
          usageHint: 'h2',
        },
      },
    },
    {
      id: 'time-row',
      component: {
        Row: {
          children: { explicitList: ['time-icon', 'time-text'] },
          gap: 'small',
          alignment: 'center',
        },
      },
    },
    {
      id: 'time-icon',
      component: {
        Icon: {
          name: { literalString: 'schedule' },
        },
      },
    },
    {
      id: 'time-text',
      component: {
        Text: {
          text: { path: '/dateTime' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'location-row',
      component: {
        Row: {
          children: { explicitList: ['location-icon', 'location-text'] },
          gap: 'small',
          alignment: 'center',
        },
      },
    },
    {
      id: 'location-icon',
      component: {
        Icon: {
          name: { literalString: 'location_on' },
        },
      },
    },
    {
      id: 'location-text',
      component: {
        Text: {
          text: { path: '/location' },
          usageHint: 'body',
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
      id: 'divider',
      component: {
        Divider: {},
      },
    },
    {
      id: 'actions',
      component: {
        Row: {
          children: { explicitList: ['accept-btn', 'decline-btn'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'accept-btn-text',
      component: {
        Text: {
          text: { literalString: 'Accept' },
        },
      },
    },
    {
      id: 'accept-btn',
      component: {
        Button: {
          child: 'accept-btn-text',
          action: 'accept',
        },
      },
    },
    {
      id: 'decline-btn-text',
      component: {
        Text: {
          text: { literalString: 'Decline' },
        },
      },
    },
    {
      id: 'decline-btn',
      component: {
        Button: {
          child: 'decline-btn-text',
          action: 'decline',
        },
      },
    },
  ],
  dataStates: [
    {
      name: 'Default',
      data: {
        title: 'Product Launch Meeting',
        dateTime: 'Thu, Dec 19 • 2:00 PM - 3:30 PM',
        location: 'Conference Room A, Building 2',
        description: 'Review final product specs and marketing materials before the Q1 launch.',
      },
    },
  ],
};

export const EVENT_DETAIL_GALLERY = { widget: EVENT_DETAIL_WIDGET, height: 300 };

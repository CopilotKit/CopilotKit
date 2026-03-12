import { Widget } from '@/types/widget';

// 29. Countdown Timer
export const COUNTDOWN_TIMER_WIDGET: Widget = {
  id: 'gallery-countdown-timer',
  name: 'Countdown Timer',
  description: 'Event countdown with days, hours, minutes',
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
          children: { explicitList: ['event-name', 'countdown-row', 'target-date'] },
          gap: 'medium',
          alignment: 'center',
        },
      },
    },
    {
      id: 'event-name',
      component: {
        Text: {
          text: { path: '/eventName' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'countdown-row',
      component: {
        Row: {
          children: { explicitList: ['days-col', 'hours-col', 'minutes-col'] },
          distribution: 'spaceAround',
        },
      },
    },
    {
      id: 'days-col',
      component: {
        Column: {
          children: { explicitList: ['days-value', 'days-label'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'days-value',
      component: {
        Text: {
          text: { path: '/days' },
          usageHint: 'h1',
        },
      },
    },
    {
      id: 'days-label',
      component: {
        Text: {
          text: { literalString: 'Days' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'hours-col',
      component: {
        Column: {
          children: { explicitList: ['hours-value', 'hours-label'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'hours-value',
      component: {
        Text: {
          text: { path: '/hours' },
          usageHint: 'h1',
        },
      },
    },
    {
      id: 'hours-label',
      component: {
        Text: {
          text: { literalString: 'Hours' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'minutes-col',
      component: {
        Column: {
          children: { explicitList: ['minutes-value', 'minutes-label'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'minutes-value',
      component: {
        Text: {
          text: { path: '/minutes' },
          usageHint: 'h1',
        },
      },
    },
    {
      id: 'minutes-label',
      component: {
        Text: {
          text: { literalString: 'Minutes' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'target-date',
      component: {
        Text: {
          text: { path: '/targetDate' },
          usageHint: 'body',
        },
      },
    },
  ],
  dataStates: [
    {
      name: 'Default',
      data: {
        eventName: 'Product Launch',
        days: '14',
        hours: '08',
        minutes: '32',
        targetDate: 'January 15, 2025',
      },
    },
  ],
};

export const COUNTDOWN_TIMER_GALLERY = { widget: COUNTDOWN_TIMER_WIDGET, height: 220 };

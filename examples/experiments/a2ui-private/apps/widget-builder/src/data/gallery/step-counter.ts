import { Widget } from '@/types/widget';

// 24. Step Counter
export const STEP_COUNTER_WIDGET: Widget = {
  id: 'gallery-step-counter',
  name: 'Step Counter',
  description: 'Daily step tracking with goal progress',
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
          children: { explicitList: ['header', 'steps-display', 'goal-text', 'divider', 'stats-row'] },
          gap: 'medium',
          alignment: 'center',
        },
      },
    },
    {
      id: 'header',
      component: {
        Row: {
          children: { explicitList: ['steps-icon', 'title'] },
          gap: 'small',
          alignment: 'center',
        },
      },
    },
    {
      id: 'steps-icon',
      component: {
        Icon: {
          name: { literalString: 'directions_walk' },
        },
      },
    },
    {
      id: 'title',
      component: {
        Text: {
          text: { literalString: "Today's Steps" },
          usageHint: 'h4',
        },
      },
    },
    {
      id: 'steps-display',
      component: {
        Text: {
          text: { path: '/steps' },
          usageHint: 'h1',
        },
      },
    },
    {
      id: 'goal-text',
      component: {
        Text: {
          text: { path: '/goalProgress' },
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
      id: 'stats-row',
      component: {
        Row: {
          children: { explicitList: ['distance-col', 'calories-col'] },
          distribution: 'spaceAround',
        },
      },
    },
    {
      id: 'distance-col',
      component: {
        Column: {
          children: { explicitList: ['distance-value', 'distance-label'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'distance-value',
      component: {
        Text: {
          text: { path: '/distance' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'distance-label',
      component: {
        Text: {
          text: { literalString: 'Distance' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'calories-col',
      component: {
        Column: {
          children: { explicitList: ['calories-value', 'calories-label'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'calories-value',
      component: {
        Text: {
          text: { path: '/calories' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'calories-label',
      component: {
        Text: {
          text: { literalString: 'Calories' },
          usageHint: 'caption',
        },
      },
    },
  ],
  dataStates: [
    {
      name: 'Default',
      data: {
        steps: '8,432',
        goalProgress: '84% of 10,000 goal',
        distance: '3.8 mi',
        calories: '312',
      },
    },
  ],
};

export const STEP_COUNTER_GALLERY = { widget: STEP_COUNTER_WIDGET, height: 240 };

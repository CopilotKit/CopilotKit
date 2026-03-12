import { Widget } from '@/types/widget';

// 16. Workout Summary
export const WORKOUT_SUMMARY_WIDGET: Widget = {
  id: 'gallery-workout-summary',
  name: 'Workout Summary',
  description: 'Exercise session summary with metrics',
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
          children: { explicitList: ['header', 'divider', 'metrics-row', 'date'] },
          gap: 'medium',
        },
      },
    },
    {
      id: 'header',
      component: {
        Row: {
          children: { explicitList: ['workout-icon', 'title'] },
          gap: 'small',
          alignment: 'center',
        },
      },
    },
    {
      id: 'workout-icon',
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
          text: { literalString: 'Workout Complete' },
          usageHint: 'h3',
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
      id: 'metrics-row',
      component: {
        Row: {
          children: { explicitList: ['duration-col', 'calories-col', 'distance-col'] },
          distribution: 'spaceAround',
        },
      },
    },
    {
      id: 'duration-col',
      component: {
        Column: {
          children: { explicitList: ['duration-value', 'duration-label'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'duration-value',
      component: {
        Text: {
          text: { path: '/duration' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'duration-label',
      component: {
        Text: {
          text: { literalString: 'Duration' },
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
      id: 'date',
      component: {
        Text: {
          text: { path: '/date' },
          usageHint: 'caption',
        },
      },
    },
  ],
  dataStates: [
    {
      name: 'Default',
      data: {
        icon: 'directions_run',
        workoutType: 'Morning Run',
        duration: '32:15',
        calories: '385',
        distance: '5.2 km',
        date: 'Today at 7:30 AM',
      },
    },
  ],
};

export const WORKOUT_SUMMARY_GALLERY = { widget: WORKOUT_SUMMARY_WIDGET, height: 280 };

import { Widget } from '@/types/widget';

export const WEATHER_CURRENT_WIDGET: Widget = {
  id: 'gallery-weather-current',
  name: 'Weather',
  description: 'Current weather conditions with temperature and forecast',
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
          children: { explicitList: ['temp-row', 'location', 'description', 'forecast-row'] },
          gap: 'small',
          alignment: 'center',
        },
      },
    },
    {
      id: 'temp-row',
      component: {
        Row: {
          children: { explicitList: ['temp-high', 'temp-low'] },
          gap: 'small',
          alignment: 'baseline',
        },
      },
    },
    {
      id: 'temp-high',
      component: {
        Text: {
          text: { path: '/tempHigh' },
          usageHint: 'h1',
        },
      },
    },
    {
      id: 'temp-low',
      component: {
        Text: {
          text: { path: '/tempLow' },
          usageHint: 'h2',
        },
      },
    },
    {
      id: 'location',
      component: {
        Text: {
          text: { path: '/location' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'description',
      component: {
        Text: {
          text: { path: '/description' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'forecast-row',
      component: {
        Row: {
          children: { explicitList: ['day1', 'day2', 'day3', 'day4', 'day5'] },
          distribution: 'spaceAround',
          gap: 'small',
        },
      },
    },
    {
      id: 'day1',
      component: {
        Column: {
          children: { explicitList: ['day1-icon', 'day1-temp'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'day1-icon',
      component: {
        Text: {
          text: { path: '/forecast/0/icon' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'day1-temp',
      component: {
        Text: {
          text: { path: '/forecast/0/temp' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'day2',
      component: {
        Column: {
          children: { explicitList: ['day2-icon', 'day2-temp'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'day2-icon',
      component: {
        Text: {
          text: { path: '/forecast/1/icon' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'day2-temp',
      component: {
        Text: {
          text: { path: '/forecast/1/temp' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'day3',
      component: {
        Column: {
          children: { explicitList: ['day3-icon', 'day3-temp'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'day3-icon',
      component: {
        Text: {
          text: { path: '/forecast/2/icon' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'day3-temp',
      component: {
        Text: {
          text: { path: '/forecast/2/temp' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'day4',
      component: {
        Column: {
          children: { explicitList: ['day4-icon', 'day4-temp'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'day4-icon',
      component: {
        Text: {
          text: { path: '/forecast/3/icon' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'day4-temp',
      component: {
        Text: {
          text: { path: '/forecast/3/temp' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'day5',
      component: {
        Column: {
          children: { explicitList: ['day5-icon', 'day5-temp'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'day5-icon',
      component: {
        Text: {
          text: { path: '/forecast/4/icon' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'day5-temp',
      component: {
        Text: {
          text: { path: '/forecast/4/temp' },
          usageHint: 'caption',
        },
      },
    },
  ],
  dataStates: [
    {
      name: 'Sunny',
      data: {
        tempHigh: '72°',
        tempLow: '58°',
        location: 'Austin, TX',
        description: 'Clear skies with light breeze',
        forecast: [
          { icon: '☀️', temp: '74°' },
          { icon: '☀️', temp: '76°' },
          { icon: '⛅', temp: '71°' },
          { icon: '☀️', temp: '73°' },
          { icon: '☀️', temp: '75°' },
        ],
      },
    },
  ],
};

export const WEATHER_CURRENT_GALLERY = {
  widget: WEATHER_CURRENT_WIDGET,
  height: 240,
};

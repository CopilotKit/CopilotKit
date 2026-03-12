import { Widget } from '@/types/widget';

export const SPORTS_PLAYER_WIDGET: Widget = {
  id: 'gallery-sports-player',
  name: 'Sports Player Card',
  description: 'Player profile with photo and stats',
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
          children: { explicitList: ['player-image', 'player-info', 'divider', 'stats-row'] },
          gap: 'medium',
          alignment: 'center',
        },
      },
    },
    {
      id: 'player-image',
      component: {
        Image: {
          url: { path: '/playerImage' },
          altText: { path: '/playerName' },
          fit: 'cover',
        },
      },
    },
    {
      id: 'player-info',
      component: {
        Column: {
          children: { explicitList: ['player-name', 'player-details'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'player-name',
      component: {
        Text: {
          text: { path: '/playerName' },
          usageHint: 'h2',
        },
      },
    },
    {
      id: 'player-details',
      component: {
        Row: {
          children: { explicitList: ['player-number', 'player-team'] },
          gap: 'small',
          alignment: 'center',
        },
      },
    },
    {
      id: 'player-number',
      component: {
        Text: {
          text: { path: '/number' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'player-team',
      component: {
        Text: {
          text: { path: '/team' },
          usageHint: 'caption',
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
          children: { explicitList: ['stat1', 'stat2', 'stat3'] },
          distribution: 'spaceAround',
        },
      },
    },
    {
      id: 'stat1',
      component: {
        Column: {
          children: { explicitList: ['stat1-value', 'stat1-label'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'stat1-value',
      component: {
        Text: {
          text: { path: '/stat1/value' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'stat1-label',
      component: {
        Text: {
          text: { path: '/stat1/label' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'stat2',
      component: {
        Column: {
          children: { explicitList: ['stat2-value', 'stat2-label'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'stat2-value',
      component: {
        Text: {
          text: { path: '/stat2/value' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'stat2-label',
      component: {
        Text: {
          text: { path: '/stat2/label' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'stat3',
      component: {
        Column: {
          children: { explicitList: ['stat3-value', 'stat3-label'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'stat3-value',
      component: {
        Text: {
          text: { path: '/stat3/value' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'stat3-label',
      component: {
        Text: {
          text: { path: '/stat3/label' },
          usageHint: 'caption',
        },
      },
    },
  ],
  dataStates: [
    {
      name: 'Default',
      data: {
        playerImage: 'https://images.unsplash.com/photo-1546519638-68e109498ffc?w=200&h=200&fit=crop',
        playerName: 'Marcus Johnson',
        number: '#23',
        team: 'LA Lakers',
        stat1: { value: '28.4', label: 'PPG' },
        stat2: { value: '7.2', label: 'RPG' },
        stat3: { value: '6.8', label: 'APG' },
      },
    },
  ],
};

export const SPORTS_PLAYER_GALLERY = { widget: SPORTS_PLAYER_WIDGET, height: 360 };

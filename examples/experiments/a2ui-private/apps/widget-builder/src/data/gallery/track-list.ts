import { Widget } from '@/types/widget';

// 18. Track List
export const TRACK_LIST_WIDGET: Widget = {
  id: 'gallery-track-list',
  name: 'Track List',
  description: 'Music playlist with track items',
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
          children: { explicitList: ['header', 'divider', 'tracks'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'header',
      component: {
        Row: {
          children: { explicitList: ['playlist-icon', 'playlist-name'] },
          gap: 'small',
          alignment: 'center',
        },
      },
    },
    {
      id: 'playlist-icon',
      component: {
        Icon: {
          name: { literalString: 'queue_music' },
        },
      },
    },
    {
      id: 'playlist-name',
      component: {
        Text: {
          text: { path: '/playlistName' },
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
      id: 'tracks',
      component: {
        Column: {
          children: { explicitList: ['track1', 'track2', 'track3'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'track1',
      component: {
        Row: {
          children: { explicitList: ['track1-num', 'track1-art', 'track1-info', 'track1-duration'] },
          gap: 'small',
          alignment: 'center',
        },
      },
    },
    {
      id: 'track1-num',
      component: {
        Text: {
          text: { literalString: '1' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'track1-art',
      component: {
        Image: {
          url: { path: '/track1/art' },
          altText: { path: '/track1/title' },
          fit: 'cover',
        },
      },
    },
    {
      id: 'track1-info',
      component: {
        Column: {
          children: { explicitList: ['track1-title', 'track1-artist'] },
        },
      },
    },
    {
      id: 'track1-title',
      component: {
        Text: {
          text: { path: '/track1/title' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'track1-artist',
      component: {
        Text: {
          text: { path: '/track1/artist' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'track1-duration',
      component: {
        Text: {
          text: { path: '/track1/duration' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'track2',
      component: {
        Row: {
          children: { explicitList: ['track2-num', 'track2-art', 'track2-info', 'track2-duration'] },
          gap: 'small',
          alignment: 'center',
        },
      },
    },
    {
      id: 'track2-num',
      component: {
        Text: {
          text: { literalString: '2' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'track2-art',
      component: {
        Image: {
          url: { path: '/track2/art' },
          altText: { path: '/track2/title' },
          fit: 'cover',
        },
      },
    },
    {
      id: 'track2-info',
      component: {
        Column: {
          children: { explicitList: ['track2-title', 'track2-artist'] },
        },
      },
    },
    {
      id: 'track2-title',
      component: {
        Text: {
          text: { path: '/track2/title' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'track2-artist',
      component: {
        Text: {
          text: { path: '/track2/artist' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'track2-duration',
      component: {
        Text: {
          text: { path: '/track2/duration' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'track3',
      component: {
        Row: {
          children: { explicitList: ['track3-num', 'track3-art', 'track3-info', 'track3-duration'] },
          gap: 'small',
          alignment: 'center',
        },
      },
    },
    {
      id: 'track3-num',
      component: {
        Text: {
          text: { literalString: '3' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'track3-art',
      component: {
        Image: {
          url: { path: '/track3/art' },
          altText: { path: '/track3/title' },
          fit: 'cover',
        },
      },
    },
    {
      id: 'track3-info',
      component: {
        Column: {
          children: { explicitList: ['track3-title', 'track3-artist'] },
        },
      },
    },
    {
      id: 'track3-title',
      component: {
        Text: {
          text: { path: '/track3/title' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'track3-artist',
      component: {
        Text: {
          text: { path: '/track3/artist' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'track3-duration',
      component: {
        Text: {
          text: { path: '/track3/duration' },
          usageHint: 'caption',
        },
      },
    },
  ],
  dataStates: [
    {
      name: 'Default',
      data: {
        playlistName: 'Focus Flow',
        track1: {
          art: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=50&h=50&fit=crop',
          title: 'Weightless',
          artist: 'Marconi Union',
          duration: '8:09',
        },
        track2: {
          art: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=50&h=50&fit=crop',
          title: 'Clair de Lune',
          artist: 'Debussy',
          duration: '5:12',
        },
        track3: {
          art: 'https://images.unsplash.com/photo-1507838153414-b4b713384a76?w=50&h=50&fit=crop',
          title: 'Ambient Light',
          artist: 'Brian Eno',
          duration: '6:45',
        },
      },
    },
  ],
};

export const TRACK_LIST_GALLERY = { widget: TRACK_LIST_WIDGET, height: 320 };

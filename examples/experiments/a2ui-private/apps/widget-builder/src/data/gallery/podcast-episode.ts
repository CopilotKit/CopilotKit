import { Widget } from '@/types/widget';

// 27. Podcast Episode
export const PODCAST_EPISODE_WIDGET: Widget = {
  id: 'gallery-podcast-episode',
  name: 'Podcast Episode',
  description: 'Podcast episode card with play button',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  root: 'root',
  components: [
    {
      id: 'root',
      component: {
        Card: {
          child: 'main-row',
        },
      },
    },
    {
      id: 'main-row',
      component: {
        Row: {
          children: { explicitList: ['artwork', 'content'] },
          gap: 'medium',
          alignment: 'start',
        },
      },
    },
    {
      id: 'artwork',
      component: {
        Image: {
          url: { path: '/artwork' },
          altText: { path: '/showName' },
          fit: 'cover',
        },
      },
    },
    {
      id: 'content',
      component: {
        Column: {
          children: { explicitList: ['show-name', 'episode-title', 'meta-row', 'description', 'play-btn'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'show-name',
      component: {
        Text: {
          text: { path: '/showName' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'episode-title',
      component: {
        Text: {
          text: { path: '/episodeTitle' },
          usageHint: 'h4',
        },
      },
    },
    {
      id: 'meta-row',
      component: {
        Row: {
          children: { explicitList: ['duration', 'date'] },
          gap: 'medium',
        },
      },
    },
    {
      id: 'duration',
      component: {
        Text: {
          text: { path: '/duration' },
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
      id: 'play-btn-text',
      component: {
        Text: {
          text: { literalString: 'Play Episode' },
        },
      },
    },
    {
      id: 'play-btn',
      component: {
        Button: {
          child: 'play-btn-text',
          action: 'play',
        },
      },
    },
  ],
  dataStates: [
    {
      name: 'Default',
      data: {
        artwork: 'https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=100&h=100&fit=crop',
        showName: 'Tech Talk Daily',
        episodeTitle: 'The Future of AI in Product Design',
        duration: '45 min',
        date: 'Dec 15, 2024',
        description: 'How AI is transforming the way we design and build products.',
      },
    },
  ],
};

export const PODCAST_EPISODE_GALLERY = { widget: PODCAST_EPISODE_WIDGET, height: 260 };

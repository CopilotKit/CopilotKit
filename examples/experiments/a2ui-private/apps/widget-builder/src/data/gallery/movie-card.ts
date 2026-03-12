import { Widget } from '@/types/widget';

// 30. Movie Card
export const MOVIE_CARD_WIDGET: Widget = {
  id: 'gallery-movie-card',
  name: 'Movie Card',
  description: 'Movie poster with rating and details',
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
          children: { explicitList: ['poster', 'content'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'poster',
      component: {
        Image: {
          url: { path: '/poster' },
          altText: { path: '/title' },
          fit: 'cover',
        },
      },
    },
    {
      id: 'content',
      component: {
        Column: {
          children: { explicitList: ['title-row', 'genre', 'rating-row', 'runtime'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'title-row',
      component: {
        Row: {
          children: { explicitList: ['movie-title', 'year'] },
          gap: 'small',
          alignment: 'baseline',
        },
      },
    },
    {
      id: 'movie-title',
      component: {
        Text: {
          text: { path: '/title' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'year',
      component: {
        Text: {
          text: { path: '/year' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'genre',
      component: {
        Text: {
          text: { path: '/genre' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'rating-row',
      component: {
        Row: {
          children: { explicitList: ['star-icon', 'rating-value'] },
          gap: 'small',
          alignment: 'center',
        },
      },
    },
    {
      id: 'star-icon',
      component: {
        Icon: {
          name: { literalString: 'star' },
        },
      },
    },
    {
      id: 'rating-value',
      component: {
        Text: {
          text: { path: '/rating' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'runtime',
      component: {
        Row: {
          children: { explicitList: ['time-icon', 'runtime-text'] },
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
      id: 'runtime-text',
      component: {
        Text: {
          text: { path: '/runtime' },
          usageHint: 'caption',
        },
      },
    },
  ],
  dataStates: [
    {
      name: 'Default',
      data: {
        poster: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=200&h=300&fit=crop',
        title: 'Interstellar',
        year: '(2014)',
        genre: 'Sci-Fi • Adventure • Drama',
        rating: '8.7/10',
        runtime: '2h 49min',
      },
    },
  ],
};

export const MOVIE_CARD_GALLERY = { widget: MOVIE_CARD_WIDGET, height: 400 };

import { Widget } from '@/types/widget';

export const USER_PROFILE_WIDGET: Widget = {
  id: 'gallery-user-profile',
  name: 'User Profile',
  description: 'User profile with stats and follow button',
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
          children: { explicitList: ['header', 'info', 'bio', 'stats-row', 'follow-btn'] },
          gap: 'medium',
          alignment: 'center',
        },
      },
    },
    {
      id: 'header',
      component: {
        Image: {
          url: { path: '/avatar' },
          altText: { path: '/name' },
          fit: 'cover',
          usageHint: 'avatar',
        },
      },
    },
    {
      id: 'info',
      component: {
        Column: {
          children: { explicitList: ['name', 'username'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'name',
      component: {
        Text: {
          text: { path: '/name' },
          usageHint: 'h2',
        },
      },
    },
    {
      id: 'username',
      component: {
        Text: {
          text: { path: '/username' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'bio',
      component: {
        Text: {
          text: { path: '/bio' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'stats-row',
      component: {
        Row: {
          children: { explicitList: ['followers-col', 'following-col', 'posts-col'] },
          distribution: 'spaceAround',
        },
      },
    },
    {
      id: 'followers-col',
      component: {
        Column: {
          children: { explicitList: ['followers-count', 'followers-label'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'followers-count',
      component: {
        Text: {
          text: { path: '/followers' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'followers-label',
      component: {
        Text: {
          text: { literalString: 'Followers' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'following-col',
      component: {
        Column: {
          children: { explicitList: ['following-count', 'following-label'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'following-count',
      component: {
        Text: {
          text: { path: '/following' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'following-label',
      component: {
        Text: {
          text: { literalString: 'Following' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'posts-col',
      component: {
        Column: {
          children: { explicitList: ['posts-count', 'posts-label'] },
          alignment: 'center',
        },
      },
    },
    {
      id: 'posts-count',
      component: {
        Text: {
          text: { path: '/posts' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'posts-label',
      component: {
        Text: {
          text: { literalString: 'Posts' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'follow-btn-text',
      component: {
        Text: {
          text: { path: '/followText' },
        },
      },
    },
    {
      id: 'follow-btn',
      component: {
        Button: {
          child: 'follow-btn-text',
          action: 'follow',
        },
      },
    },
  ],
  dataStates: [
    {
      name: 'Default',
      data: {
        avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&h=150&fit=crop',
        name: 'Sarah Chen',
        username: '@sarahchen',
        bio: 'Product Designer at Tech Co. Creating delightful experiences.',
        followers: '12.4K',
        following: '892',
        posts: '347',
        followText: 'Follow',
      },
    },
    {
      name: 'Following',
      data: {
        avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop',
        name: 'Alex Rivera',
        username: '@alexrivera',
        bio: 'Software Engineer. Open source enthusiast.',
        followers: '8.2K',
        following: '1.2K',
        posts: '156',
        followText: 'Following',
      },
    },
  ],
};

export const USER_PROFILE_GALLERY = {
  widget: USER_PROFILE_WIDGET,
  height: 300,
};

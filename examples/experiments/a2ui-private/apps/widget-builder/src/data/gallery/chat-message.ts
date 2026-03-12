import { Widget } from '@/types/widget';

export const CHAT_MESSAGE_WIDGET: Widget = {
  id: 'gallery-chat-message',
  name: 'Chat Message Thread',
  description: 'Messaging thread with multiple messages and user avatars',
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
          children: { explicitList: ['header', 'divider', 'messages'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'header',
      component: {
        Row: {
          children: { explicitList: ['channel-icon', 'channel-name'] },
          gap: 'small',
          alignment: 'center',
        },
      },
    },
    {
      id: 'channel-icon',
      component: {
        Icon: {
          name: { literalString: 'tag' },
        },
      },
    },
    {
      id: 'channel-name',
      component: {
        Text: {
          text: { path: '/channelName' },
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
      id: 'messages',
      component: {
        Column: {
          children: { explicitList: ['message1', 'message2'] },
          gap: 'medium',
          alignment: 'start',
        },
      },
    },
    {
      id: 'message1',
      component: {
        Row: {
          children: { explicitList: ['avatar1', 'msg1-content'] },
          gap: 'small',
          alignment: 'start',
        },
      },
    },
    {
      id: 'avatar1',
      component: {
        Image: {
          url: { path: '/message1/avatar' },
          altText: { path: '/message1/username' },
          fit: 'cover',
          usageHint: 'avatar',
        },
      },
    },
    {
      id: 'msg1-content',
      component: {
        Column: {
          children: { explicitList: ['msg1-header', 'msg1-text'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'msg1-header',
      component: {
        Row: {
          children: { explicitList: ['msg1-username', 'msg1-time'] },
          gap: 'small',
          alignment: 'center',
        },
      },
    },
    {
      id: 'msg1-username',
      component: {
        Text: {
          text: { path: '/message1/username' },
          usageHint: 'h4',
        },
      },
    },
    {
      id: 'msg1-time',
      component: {
        Text: {
          text: { path: '/message1/time' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'msg1-text',
      component: {
        Text: {
          text: { path: '/message1/text' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'message2',
      component: {
        Row: {
          children: { explicitList: ['avatar2', 'msg2-content'] },
          gap: 'small',
          alignment: 'start',
        },
      },
    },
    {
      id: 'avatar2',
      component: {
        Image: {
          url: { path: '/message2/avatar' },
          altText: { path: '/message2/username' },
          fit: 'cover',
          usageHint: 'avatar',
        },
      },
    },
    {
      id: 'msg2-content',
      component: {
        Column: {
          children: { explicitList: ['msg2-header', 'msg2-text'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'msg2-header',
      component: {
        Row: {
          children: { explicitList: ['msg2-username', 'msg2-time'] },
          gap: 'small',
          alignment: 'center',
        },
      },
    },
    {
      id: 'msg2-username',
      component: {
        Text: {
          text: { path: '/message2/username' },
          usageHint: 'h4',
        },
      },
    },
    {
      id: 'msg2-time',
      component: {
        Text: {
          text: { path: '/message2/time' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'msg2-text',
      component: {
        Text: {
          text: { path: '/message2/text' },
          usageHint: 'body',
        },
      },
    },
  ],
  dataStates: [
    {
      name: 'Default',
      data: {
        channelName: 'project-updates',
        message1: {
          avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=40&h=40&fit=crop',
          username: 'Mike Chen',
          time: '10:32 AM',
          text: 'Just pushed the new API changes. Ready for review.',
        },
        message2: {
          avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=40&h=40&fit=crop',
          username: 'Sarah Kim',
          time: '10:45 AM',
          text: "Great! I'll take a look after standup.",
        },
      },
    },
  ],
};

export const CHAT_MESSAGE_GALLERY = { widget: CHAT_MESSAGE_WIDGET, height: 300 };

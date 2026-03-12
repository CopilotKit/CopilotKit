import { Widget } from '@/types/widget';

export const TASK_CARD_WIDGET: Widget = {
  id: 'gallery-task-card',
  name: 'Task Card',
  description: 'Task item with priority and due date',
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
          children: { explicitList: ['content', 'priority'] },
          gap: 'medium',
          alignment: 'start',
        },
      },
    },
    {
      id: 'content',
      component: {
        Column: {
          children: { explicitList: ['title', 'description', 'meta-row'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'title',
      component: {
        Text: {
          text: { path: '/title' },
          usageHint: 'h3',
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
      id: 'meta-row',
      component: {
        Row: {
          children: { explicitList: ['due-date', 'project'] },
          gap: 'medium',
        },
      },
    },
    {
      id: 'due-date',
      component: {
        Text: {
          text: { path: '/dueDate' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'project',
      component: {
        Text: {
          text: { path: '/project' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'priority',
      component: {
        Icon: {
          name: { path: '/priorityIcon' },
        },
      },
    },
  ],
  dataStates: [
    {
      name: 'High Priority',
      data: {
        title: 'Review pull request',
        description: 'Review and approve the authentication module changes.',
        dueDate: 'Today',
        project: 'Backend',
        priorityIcon: 'priority_high',
      },
    },
  ],
};

export const TASK_CARD_GALLERY = {
  widget: TASK_CARD_WIDGET,
  height: 120,
};

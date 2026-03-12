import { Widget } from '@/types/widget';

export const EMAIL_COMPOSE_WIDGET: Widget = {
  id: 'gallery-email-compose',
  name: 'Email Compose',
  description: 'Email composition form with recipient and message fields',
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
          children: { explicitList: ['from-row', 'to-row', 'subject-row', 'divider', 'message', 'actions'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'from-row',
      component: {
        Row: {
          children: { explicitList: ['from-label', 'from-value'] },
          gap: 'medium',
          alignment: 'center',
        },
      },
    },
    {
      id: 'from-label',
      component: {
        Text: {
          text: { literalString: 'FROM' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'from-value',
      component: {
        Text: {
          text: { path: '/from' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'to-row',
      component: {
        Row: {
          children: { explicitList: ['to-label', 'to-value'] },
          gap: 'medium',
          alignment: 'center',
        },
      },
    },
    {
      id: 'to-label',
      component: {
        Text: {
          text: { literalString: 'TO' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'to-value',
      component: {
        Text: {
          text: { path: '/to' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'subject-row',
      component: {
        Row: {
          children: { explicitList: ['subject-label', 'subject-value'] },
          gap: 'medium',
          alignment: 'center',
        },
      },
    },
    {
      id: 'subject-label',
      component: {
        Text: {
          text: { literalString: 'SUBJECT' },
          usageHint: 'caption',
        },
      },
    },
    {
      id: 'subject-value',
      component: {
        Text: {
          text: { path: '/subject' },
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
      id: 'message',
      component: {
        Column: {
          children: { explicitList: ['greeting', 'body-text', 'closing', 'signature'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'greeting',
      component: {
        Text: {
          text: { path: '/greeting' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'body-text',
      component: {
        Text: {
          text: { path: '/body' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'closing',
      component: {
        Text: {
          text: { path: '/closing' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'signature',
      component: {
        Text: {
          text: { path: '/signature' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'actions',
      component: {
        Row: {
          children: { explicitList: ['send-btn', 'discard-btn'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'send-btn-text',
      component: {
        Text: {
          text: { literalString: 'Send email' },
        },
      },
    },
    {
      id: 'send-btn',
      component: {
        Button: {
          child: 'send-btn-text',
          action: 'send',
        },
      },
    },
    {
      id: 'discard-btn-text',
      component: {
        Text: {
          text: { literalString: 'Discard' },
        },
      },
    },
    {
      id: 'discard-btn',
      component: {
        Button: {
          child: 'discard-btn-text',
          action: 'discard',
        },
      },
    },
  ],
  dataStates: [
    {
      name: 'Default',
      data: {
        from: 'alex@acme.com',
        to: 'jordan@acme.com',
        subject: 'Q4 Revenue Forecast',
        greeting: 'Hi Jordan,',
        body: "Following up on our call. Please review the attached Q4 forecast and let me know if you have questions before the board meeting.",
        closing: 'Best,',
        signature: 'Alex',
      },
    },
    {
      name: 'Meeting Request',
      data: {
        from: 'sarah@company.com',
        to: 'team@company.com',
        subject: 'Budget Approval Required',
        greeting: 'Hi Team,',
        body: "The marketing budget for Q1 needs final approval by Friday. Please submit your department estimates by EOD tomorrow.",
        closing: 'Thanks,',
        signature: 'Sarah',
      },
    },
  ],
};

export const EMAIL_COMPOSE_GALLERY = {
  widget: EMAIL_COMPOSE_WIDGET,
  height: 340,
};

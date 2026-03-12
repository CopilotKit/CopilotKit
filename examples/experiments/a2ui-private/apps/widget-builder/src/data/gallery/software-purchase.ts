import { Widget } from '@/types/widget';

// 19. Software Purchase Form
export const SOFTWARE_PURCHASE_WIDGET: Widget = {
  id: 'gallery-software-purchase',
  name: 'Software Purchase Form',
  description: 'Software licensing purchase with options',
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
          children: { explicitList: ['title', 'product-name', 'divider1', 'options', 'divider2', 'total-row', 'actions'] },
          gap: 'medium',
        },
      },
    },
    {
      id: 'title',
      component: {
        Text: {
          text: { literalString: 'Purchase License' },
          usageHint: 'h3',
        },
      },
    },
    {
      id: 'product-name',
      component: {
        Text: {
          text: { path: '/productName' },
          usageHint: 'h2',
        },
      },
    },
    {
      id: 'divider1',
      component: {
        Divider: {},
      },
    },
    {
      id: 'options',
      component: {
        Column: {
          children: { explicitList: ['seats-row', 'period-row'] },
          gap: 'medium',
        },
      },
    },
    {
      id: 'seats-row',
      component: {
        Row: {
          children: { explicitList: ['seats-label', 'seats-value'] },
          distribution: 'spaceBetween',
          alignment: 'center',
        },
      },
    },
    {
      id: 'seats-label',
      component: {
        Text: {
          text: { literalString: 'Number of seats' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'seats-value',
      component: {
        Text: {
          text: { path: '/seats' },
          usageHint: 'h4',
        },
      },
    },
    {
      id: 'period-row',
      component: {
        Row: {
          children: { explicitList: ['period-label', 'period-value'] },
          distribution: 'spaceBetween',
          alignment: 'center',
        },
      },
    },
    {
      id: 'period-label',
      component: {
        Text: {
          text: { literalString: 'Billing period' },
          usageHint: 'body',
        },
      },
    },
    {
      id: 'period-value',
      component: {
        Text: {
          text: { path: '/billingPeriod' },
          usageHint: 'h4',
        },
      },
    },
    {
      id: 'divider2',
      component: {
        Divider: {},
      },
    },
    {
      id: 'total-row',
      component: {
        Row: {
          children: { explicitList: ['total-label', 'total-value'] },
          distribution: 'spaceBetween',
          alignment: 'center',
        },
      },
    },
    {
      id: 'total-label',
      component: {
        Text: {
          text: { literalString: 'Total' },
          usageHint: 'h4',
        },
      },
    },
    {
      id: 'total-value',
      component: {
        Text: {
          text: { path: '/total' },
          usageHint: 'h2',
        },
      },
    },
    {
      id: 'actions',
      component: {
        Row: {
          children: { explicitList: ['confirm-btn', 'cancel-btn'] },
          gap: 'small',
        },
      },
    },
    {
      id: 'confirm-btn-text',
      component: {
        Text: {
          text: { literalString: 'Confirm Purchase' },
        },
      },
    },
    {
      id: 'confirm-btn',
      component: {
        Button: {
          child: 'confirm-btn-text',
          action: 'confirm',
        },
      },
    },
    {
      id: 'cancel-btn-text',
      component: {
        Text: {
          text: { literalString: 'Cancel' },
        },
      },
    },
    {
      id: 'cancel-btn',
      component: {
        Button: {
          child: 'cancel-btn-text',
          action: 'cancel',
        },
      },
    },
  ],
  dataStates: [
    {
      name: 'Default',
      data: {
        productName: 'Design Suite Pro',
        seats: '10 seats',
        billingPeriod: 'Annual',
        total: '$1,188/year',
      },
    },
  ],
};

export const SOFTWARE_PURCHASE_GALLERY = { widget: SOFTWARE_PURCHASE_WIDGET, height: 340 };
